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
import { getAgentConfig, loadAllAgentConfigs } from './agent-config.js';

const env = readEnvFile();

let bot: Bot | null = null;
let isReady = false;

export async function initTelegram(): Promise<Bot> {
  if (bot) {
    return bot;
  }

  const token = env['TELEGRAM_BOT_TOKEN'];
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
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
    const agents = loadAllAgentConfigs();

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
      const agents = loadAllAgentConfigs();
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
      const agents = loadAllAgentConfigs();
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
    await ctx.reply(`Error: ${String(error)}`);
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

    const fileUrl = `https://api.telegram.org/file/bot${env['TELEGRAM_BOT_TOKEN']}/${file.file_path}`;
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
    await ctx.reply(`Voice error: ${String(error)}`);
  }
}

async function processUserPrompt(ctx: Context, text: string): Promise<void> {
  const chatId = getChatId(ctx);
  const agentId = getChatAgentId(chatId);
  await ctx.replyWithChatAction('typing');

  await saveConversationTurn(chatId, 'user', text, agentId, false);
  const result = await orchestrator.runWithContext(chatId, text, agentId, true);
  await saveConversationTurn(chatId, 'assistant', result.content, agentId, true);

  await ctx.reply(result.content || '(No response)');
}

function getChatId(ctx: Context): string {
  return String(ctx.chat?.id ?? ctx.from?.id ?? 'unknown');
}

function getChatAgentId(chatId: string): string {
  return getSelectedAgent(chatId) ?? env['DEFAULT_AGENT_ID'] ?? 'main';
}

export async function sendTelegramMessage(chatId: string, message: string): Promise<void> {
  if (!bot || !isReady) {
    throw new Error('Telegram bot not ready');
  }

  await bot.api.sendMessage(chatId, message);
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
