import { Bot, InputFile, type Context } from 'grammy';
import { logger } from './logger.js';
import { readEnvFile } from './env.js';
import { orchestrator } from './orchestrator.js';
import { isAuthorized, checkRateLimit, recordMessage, isSuspicious, blockUser } from './security.js';
import { checkPromptInjection, sanitizeInput } from './exfiltration-guard.js';
import { getScheduledTasks } from './scheduler.js';
import { getDashboardStats } from './dashboard.js';
import { saveConversationTurn } from './memory.js';
import { getRecentTurns } from './db.js';
import { speechToText } from './voice.js';
import { clearSelectedAgent, getSelectedAgent, setSelectedAgent } from './state.js';
import { getAgentConfig, getAllAgents, agentExists } from './agent-config.js';

const env = readEnvFile();
const TELEGRAM_MESSAGE_LIMIT = 4096;
const TELEGRAM_SAFE_CHUNK_SIZE = 3900;

let bot: Bot | null = null;
let isReady = false;

export async function initTelegram(): Promise<Bot> {
  if (bot) {
    return bot;
  }

  const runtimeEnv = readEnvFile();
  const processAgentId = process.env['CLAUDECLAW_AGENT_ID'] || process.env['AGENT_ID'] || '';
  const token = resolveTelegramToken(processAgentId, runtimeEnv);
  if (!token) {
    throw new Error(processAgentId
      ? `Telegram token is required for agent "${processAgentId}"`
      : 'TELEGRAM_BOT_TOKEN is required');
  }

  bot = new Bot(token);

  bot.command('start', async (ctx) => {
    await ctx.reply(
      "Hello. I'm ClaudeClaw, your local Claude Code assistant.\n\nType /help for commands."
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        'Available commands:',
        '/start - Start the bot',
        '/help - Show help',
        '/agent - Show or set the active agent',
        '/agents - List available agents',
        '/status - Show system status',
        '/memory - Show memory stats',
        '/history - Show recent conversation history',
        '/tasks - List scheduled tasks',
        '/dashboard - Get dashboard URL',
        'Voice messages are supported when GROQ_API_KEY is configured.',
      ].join('\n')
    );
  });

  bot.command('status', async (ctx) => {
    const stats = getDashboardStats();
    await ctx.reply(
      [
        'System Status:',
        `Memory: ${stats.memory?.total || 0} memories`,
        `Scheduler: ${stats.scheduler?.running ? 'Running' : 'Stopped'}`,
        `Tasks: ${stats.scheduler?.totalTasks || 0}`,
        `Security: ${stats.security?.authorizedUsers || 0} authorized`,
      ].join('\n')
    );
  });

  bot.command('agents', async (ctx) => {
    const current = getChatAgentId(getChatId(ctx));
    const agents = getAllAgents();

    if (agents.length === 0) {
      await ctx.reply(`No agent configs found. Current agent: ${current}`);
      return;
    }

    await ctx.reply(
      [
        'Available agents:',
        ...agents.map((agent) => `${agent.id}${agent.id === current ? ' (active)' : ''} - ${agent.name}${agent.description ? `: ${agent.description}` : ''}`),
      ].join('\n')
    );
  });

  bot.command('agent', async (ctx) => {
    const chatId = getChatId(ctx);
    const raw = String(ctx.match ?? '').trim();
    const current = getChatAgentId(chatId);

    if (!raw) {
      const agents = getAllAgents();
      await ctx.reply(
        [
          `Current agent: ${current}`,
          agents.length > 0 ? 'Available agents:' : 'No agent configs found.',
          ...agents.map((agent) => `- ${agent.id}${agent.id === current ? ' (active)' : ''}`),
          '',
          'Use /agent <id> to switch, or /agent clear to go back to the default.',
        ].filter(Boolean).join('\n')
      );
      return;
    }

    const requested = raw.split(/\s+/)[0].trim().toLowerCase();
    if (requested === 'clear' || requested === 'default') {
      clearSelectedAgent(chatId);
      await ctx.reply(`Cleared custom agent. Active agent is now ${getChatAgentId(chatId)}.`);
      return;
    }

    const agent = getAgentConfig(requested);
    if (!agent) {
      const agents = getAllAgents();
      await ctx.reply(
        [
          `Unknown agent: ${requested}`,
          agents.length > 0 ? `Available: ${agents.map((a) => a.id).join(', ')}` : 'No agent configs found.',
        ].join('\n')
      );
      return;
    }

    setSelectedAgent(chatId, agent.id);
    await ctx.reply(`Active agent set to ${agent.id} (${agent.name}).`);
  });

  bot.command('memory', async (ctx) => {
    const stats = getDashboardStats();
    await ctx.reply(
      [
        'Memory Stats:',
        `Total: ${stats.memory?.total || 0}`,
        `Pinned: ${stats.memory?.pinned || 0}`,
        `Consolidated: ${stats.memory?.consolidated || 0}`,
      ].join('\n')
    );
  });

  bot.command('history', async (ctx) => {
    const chatId = getChatId(ctx);
    const history = getRecentTurns(chatId, 10).reverse();
    if (history.length === 0) {
      await ctx.reply('No conversation history yet.');
      return;
    }

    await ctx.reply(
      history
        .map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content.slice(0, 180)}`)
        .join('\n\n')
    );
  });

  bot.command('tasks', async (ctx) => {
    const tasks = getScheduledTasks();
    if (tasks.length === 0) {
      await ctx.reply('No scheduled tasks.');
      return;
    }

    await ctx.reply(tasks.map((t) => `${t.id}: ${t.schedule} (${t.status})`).join('\n'));
  });

  bot.command('dashboard', async (ctx) => {
    await ctx.reply(`Dashboard: ${env['DASHBOARD_URL'] || 'http://localhost:3141'}`);
  });

  bot.on('message:text', async (ctx) => {
    await handleTextMessage(ctx);
  });

  bot.on('message:voice', async (ctx) => {
    await handleVoiceMessage(ctx);
  });

  void bot.start({
    onStart: (info) => {
      isReady = true;
      logger.info({ username: info.username }, 'Telegram bot started');
    },
  }).catch((error) => {
    isReady = false;
    logger.error({ error }, 'Telegram bot stopped with error');
  });

  return bot;
}

async function handleTextMessage(ctx: Context): Promise<void> {
  const chatId = getChatId(ctx);
  const senderName = ctx.from?.first_name || ctx.from?.username || 'Unknown';
  const rawText = ctx.message && 'text' in ctx.message ? (ctx.message.text ?? '') : '';

  try {
    recordMessage(chatId);

    if (!checkRateLimit(chatId).allowed) {
      await ctx.reply('Rate limit exceeded. Please wait a moment.');
      return;
    }

    if (!isAuthorized(chatId, 'telegram')) {
      logger.warn({ chatId, senderName }, 'Unauthorized Telegram message');
      await ctx.reply('Sorry, you are not authorized to use this bot.');
      return;
    }

    if (isSuspicious(chatId)) {
      blockUser(chatId);
      await ctx.reply('Message blocked for security reasons.');
      return;
    }

    const injectionCheck = checkPromptInjection(rawText);
    if (injectionCheck.suspicious) {
      logger.warn({ chatId, indicators: injectionCheck.indicators }, 'Prompt injection detected');
      await ctx.reply('Message rejected for security reasons.');
      return;
    }

    await processUserPrompt(ctx, sanitizeInput(rawText));
  } catch (error) {
    logger.error({ error, chatId }, 'Error handling Telegram message');
    await replyLong(ctx, `Error: ${formatErrorForUser(error)}`);
  }
}

async function handleVoiceMessage(ctx: Context): Promise<void> {
  const chatId = getChatId(ctx);
  const senderName = ctx.from?.first_name || ctx.from?.username || 'Unknown';

  try {
    recordMessage(chatId);

    if (!checkRateLimit(chatId).allowed) {
      await ctx.reply('Rate limit exceeded. Please wait a moment.');
      return;
    }

    if (!isAuthorized(chatId, 'telegram')) {
      logger.warn({ chatId, senderName }, 'Unauthorized Telegram voice message');
      await ctx.reply('Sorry, you are not authorized to use this bot.');
      return;
    }

    if (!env['GROQ_API_KEY']) {
      await ctx.reply('Voice input needs GROQ_API_KEY in .env for Whisper transcription. Text messages are ready now.');
      return;
    }

    const voice = ctx.message && 'voice' in ctx.message ? ctx.message.voice : null;
    if (!voice?.file_id || !bot) {
      await ctx.reply('I could not read that voice message.');
      return;
    }

    await ctx.replyWithChatAction('typing');
    const file = await bot.api.getFile(voice.file_id);
    if (!file.file_path) {
      await ctx.reply('Telegram did not provide a downloadable voice file.');
      return;
    }

    const runtimeToken = resolveTelegramToken(process.env['CLAUDECLAW_AGENT_ID'] || process.env['AGENT_ID'] || '', readEnvFile());
    const fileUrl = `https://api.telegram.org/file/bot${runtimeToken}/${file.file_path}`;
    const response = await fetch(fileUrl);
    if (!response.ok) {
      await ctx.reply(`Could not download voice message from Telegram (${response.status}).`);
      return;
    }

    const audio = Buffer.from(await response.arrayBuffer());
    const transcription = sanitizeInput(await speechToText(audio));
    if (!transcription) {
      await ctx.reply('I could not transcribe that voice message.');
      return;
    }

    await ctx.reply(`Transcribed: ${transcription}`);
    await processUserPrompt(ctx, transcription);
  } catch (error) {
    logger.error({ error, chatId }, 'Error handling Telegram voice message');
    await replyLong(ctx, `Voice error: ${formatErrorForUser(error)}`);
  }
}

async function processUserPrompt(ctx: Context, text: string): Promise<void> {
  const chatId = getChatId(ctx);
  let agentId = getChatAgentId(chatId);
  let processText = text.trim();

  // Handle inline agent routing e.g. "@ops deploy"
  const match = processText.match(/^@([a-zA-Z0-9_-]+)\s+(.*)/s);
  if (match) {
    const requestedAgent = match[1];
    if (agentExists(requestedAgent)) {
      agentId = requestedAgent;
      processText = match[2];
      await ctx.reply(`[Routing request to @${agentId}]`);
    }
  }

  await ctx.replyWithChatAction('typing');

  await saveConversationTurn(chatId, 'user', processText, agentId, false);
  const result = await orchestrator.runWithContext(chatId, processText, agentId, true);
  await saveConversationTurn(chatId, 'assistant', result.content, agentId, true);

  await replyLong(ctx, result.content || '(No response)');
}

function getChatId(ctx: Context): string {
  return String(ctx.chat?.id ?? ctx.from?.id ?? 'unknown');
}

function getChatAgentId(chatId: string): string {
  return process.env['CLAUDECLAW_AGENT_ID']
    || process.env['AGENT_ID']
    || getSelectedAgent(chatId)
    || env['DEFAULT_AGENT_ID']
    || 'main';
}

function resolveTelegramToken(agentId: string, runtimeEnv: Record<string, string>): string {
  if (agentId) {
    const config = getAgentConfig(agentId);
    const envKey = `${agentId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TELEGRAM_TOKEN`;
    return config?.telegramToken || runtimeEnv[envKey] || runtimeEnv['TELEGRAM_BOT_TOKEN'] || '';
  }

  return runtimeEnv['TELEGRAM_BOT_TOKEN'] || '';
}

export function splitTelegramMessage(message: string): string[] {
  if (message.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [message];
  }

  const chunks: string[] = [];
  let remaining = message;

  while (remaining.length > TELEGRAM_SAFE_CHUNK_SIZE) {
    const slice = remaining.slice(0, TELEGRAM_SAFE_CHUNK_SIZE);
    const splitAt = Math.max(
      slice.lastIndexOf('\n\n'),
      slice.lastIndexOf('\n'),
      slice.lastIndexOf('. '),
      slice.lastIndexOf(' ')
    );
    const cut = splitAt > 1000 ? splitAt + (slice[splitAt] === '.' ? 1 : 0) : TELEGRAM_SAFE_CHUNK_SIZE;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

async function replyLong(ctx: Context, message: string): Promise<void> {
  const chunks = splitTelegramMessage(message);
  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

function formatErrorForUser(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 1500 ? `${message.slice(0, 1500)}...` : message;
}

export async function sendTelegramMessage(chatId: string, message: string): Promise<void> {
  if (!bot || !isReady) {
    throw new Error('Telegram bot not ready');
  }

  for (const chunk of splitTelegramMessage(message)) {
    await bot.api.sendMessage(chatId, chunk);
  }
}

export async function sendTelegramVoice(
  chatId: string,
  audioPath: string,
  caption?: string
): Promise<void> {
  if (!bot || !isReady) {
    throw new Error('Telegram bot not ready');
  }

  await bot.api.sendVoice(chatId, new InputFile(audioPath), { caption });
}

export function getTelegramStatus(): {
  initialized: boolean;
  ready: boolean;
} {
  return {
    initialized: bot !== null,
    ready: isReady,
  };
}

export async function stopTelegram(): Promise<void> {
  if (bot) {
    bot.stop();
    bot = null;
    isReady = false;
    logger.info('Telegram bot stopped');
  }
}

export async function getEntityInfo(chatId: string): Promise<{
  id: string;
  name: string;
  type: string;
} | null> {
  return {
    id: chatId,
    name: chatId,
    type: 'telegram',
  };
}
