import { App, type SlashCommand, type SayArguments } from '@slack/bolt';
import { logger } from './logger.js';
import { readEnvFile } from './env.js';
import { orchestrator } from './orchestrator.js';
import { isAuthorized } from './security.js';
import { checkPromptInjection, sanitizeInput } from './exfiltration-guard.js';
import { saveSlackMessage } from './db.js';

const env = readEnvFile();

let slackApp: App | null = null;
let isReady = false;

/**
 * Initialize Slack app
 */
export async function initSlack(): Promise<App> {
  if (slackApp) {
    logger.warn('Slack app already initialized');
    return slackApp;
  }

  const slackToken = env['SLACK_BOT_TOKEN'];
  const slackSigningSecret = env['SLACK_SIGNING_SECRET'];
  const slackAppToken = env['SLACK_APP_TOKEN'];

  if (!slackToken || !slackSigningSecret) {
    throw new Error('SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET are required');
  }

  slackApp = new App({
    token: slackToken,
    signingSecret: slackSigningSecret,
    socketMode: !!slackAppToken,
    appToken: slackAppToken,
    customRoutes: [
      {
        path: '/health',
        method: ['GET'],
        handler: async (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', service: 'slack' }));
        },
      },
    ],
  });

  // Register event handlers
  slackApp.event('app_mention', async ({ event, client }) => {
    await handleAppMention(event, client);
  });

  slackApp.event('message', async ({ event, client }) => {
    await handleMessage(event, client);
  });

  // Register slash commands
  slackApp.command('/claude', async ({ command, ack, respond }) => {
    await handleSlashCommand(command, ack, respond);
  });

  slackApp.command('/claude-memory', async ({ command, ack, respond }) => {
    await handleMemoryCommand(command, ack, respond);
  });

  await slackApp.start(parseInt(env['SLACK_PORT'] || '3000', 10));
  
  isReady = true;
  logger.info('Slack app initialized and running');
  
  return slackApp;
}

/**
 * Handle app_mention events
 */
async function handleAppMention(event: any, client: any): Promise<void> {
  try {
    const userId = event.user;
    const channelId = event.channel;
    const threadTs = event.thread_ts || event.ts;
    const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

    const userInfo = await client.users.info({ user: userId });
    const senderName = userInfo.user?.real_name || userInfo.user?.name || 'Unknown';

    // Save message to database
    saveSlackMessage({
      message_id: event.ts,
      channel_id: channelId,
      user_id: userId,
      user_name: senderName,
      message: text,
      timestamp: parseInt(event.ts, 10) * 1000,
      direction: 'incoming',
    });

    // Check authorization
    const authId = `slack:${userId}`;
    if (!isAuthorized(authId, 'slack')) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `Sorry <@${userId}>, you are not authorized to use this bot.`,
      });
      return;
    }

    // Check for prompt injection
    if (checkPromptInjection(text)) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Message rejected for security reasons.',
      });
      return;
    }

    const sanitizedMessage = sanitizeInput(text);

    // Process through orchestrator
    const result = await orchestrator.runWithContext(
      channelId,
      sanitizedMessage,
      'main',
      true
    );

    // Send response
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: result.content,
      username: 'ClaudeClaw',
      icon_emoji: ':robot_face:',
    });

    // Save outgoing message
    saveSlackMessage({
      message_id: `out_${Date.now()}`,
      channel_id: channelId,
      user_id: 'ClaudeClaw',
      user_name: 'ClaudeClaw',
      message: result.content,
      timestamp: Date.now(),
      direction: 'outgoing',
    });

    logger.info({ channelId, userId, senderName }, 'Slack app_mention processed');
  } catch (error) {
    logger.error({ error }, 'Error handling Slack app_mention');
  }
}

/**
 * Handle direct messages
 */
async function handleMessage(event: any, client: any): Promise<void> {
  // Only handle direct messages (not mentions in channels)
  if (event.channel_type !== 'im') {
    return;
  }

  try {
    const userId = event.user;
    const channelId = event.channel;
    const text = event.text;

    const userInfo = await client.users.info({ user: userId });
    const senderName = userInfo.user?.real_name || userInfo.user?.name || 'Unknown';

    // Save message
    saveSlackMessage({
      message_id: event.ts,
      channel_id: channelId,
      user_id: userId,
      user_name: senderName,
      message: text,
      timestamp: parseInt(event.ts, 10) * 1000,
      direction: 'incoming',
    });

    // Check authorization
    const authId = `slack:${userId}`;
    if (!isAuthorized(authId, 'slack')) {
      await client.chat.postMessage({
        channel: channelId,
        text: `Sorry, you are not authorized to use this bot.`,
      });
      return;
    }

    // Check for prompt injection
    if (checkPromptInjection(text)) {
      await client.chat.postMessage({
        channel: channelId,
        text: 'Message rejected for security reasons.',
      });
      return;
    }

    const sanitizedMessage = sanitizeInput(text);

    // Process through orchestrator
    const result = await orchestrator.runWithContext(
      channelId,
      sanitizedMessage,
      'main',
      true
    );

    // Send response
    await client.chat.postMessage({
      channel: channelId,
      text: result.content,
      username: 'ClaudeClaw',
      icon_emoji: ':robot_face:',
    });

    logger.info({ channelId, userId }, 'Slack DM processed');
  } catch (error) {
    logger.error({ error }, 'Error handling Slack DM');
  }
}

/**
 * Handle /claude slash command
 */
async function handleSlashCommand(
  command: SlashCommand,
  ack: Function,
  respond: Function
): Promise<void> {
  await ack();

  try {
    const userId = command.user_id;
    const channelId = command.channel_id;
    const text = command.text.trim();

    const userInfo = await slackApp?.client.users.info({ user: userId });
    const senderName = userInfo?.user?.real_name || userInfo?.user?.name || 'Unknown';

    // Check authorization
    const authId = `slack:${userId}`;
    if (!isAuthorized(authId, 'slack')) {
      await respond({
        response_type: 'ephemeral',
        text: `Sorry <@${userId}>, you are not authorized to use this bot.`,
      });
      return;
    }

    if (!text) {
      await respond({
        response_type: 'ephemeral',
        text: 'Usage: /claude <message>\nExample: /claude What is the weather today?',
      });
      return;
    }

    // Check for prompt injection
    if (checkPromptInjection(text)) {
      await respond({
        response_type: 'ephemeral',
        text: 'Message rejected for security reasons.',
      });
      return;
    }

    const sanitizedMessage = sanitizeInput(text);

    // Show "thinking" response
    await respond({
      response_type: 'in_channel',
      text: `<@${userId}> I'm thinking...`,
    });

    // Process through orchestrator
    const result = await orchestrator.runWithContext(
      channelId,
      sanitizedMessage,
      'main',
      true
    );

    // Send final response
    await respond({
      response_type: 'in_channel',
      text: result.content,
      username: 'ClaudeClaw',
      icon_emoji: ':robot_face:',
    });

    logger.info({ channelId, userId, command: text }, 'Slack slash command processed');
  } catch (error) {
    logger.error({ error }, 'Error handling Slack slash command');
    await respond({
      response_type: 'ephemeral',
      text: `Error: ${error}`,
    });
  }
}

/**
 * Handle /claude-memory slash command
 */
async function handleMemoryCommand(
  command: SlashCommand,
  ack: Function,
  respond: Function
): Promise<void> {
  await ack();

  try {
    const userId = command.user_id;
    const text = command.text.trim();
    const parts = text.split(' ');
    const subcommand = parts[0]?.toLowerCase();

    const authId = `slack:${userId}`;
    if (!isAuthorized(authId, 'slack')) {
      await respond({
        response_type: 'ephemeral',
        text: `Sorry <@${userId}>, you are not authorized to use this bot.`,
      });
      return;
    }

    switch (subcommand) {
      case 'list':
        await respond({
          response_type: 'ephemeral',
          text: 'Use the dashboard to view memory. Access it at: ' + (env['DASHBOARD_URL'] || 'http://localhost:3001'),
        });
        break;
      case 'search':
        const query = parts.slice(1).join(' ');
        await respond({
          response_type: 'ephemeral',
          text: `Searching memory for: "${query}" - Use the dashboard for full search results.`,
        });
        break;
      case 'stats':
        await respond({
          response_type: 'ephemeral',
          text: 'Use the dashboard to view memory statistics.',
        });
        break;
      default:
        await respond({
          response_type: 'ephemeral',
          text: `Usage: /claude-memory <list|search|stats>\n- list: List recent memories\n- search <query>: Search memories\n- stats: View memory statistics`,
        });
    }
  } catch (error) {
    logger.error({ error }, 'Error handling memory command');
    await respond({
      response_type: 'ephemeral',
      text: `Error: ${error}`,
    });
  }
}

/**
 * Send a message to a Slack channel
 */
export async function sendSlackMessage(
  channelId: string,
  message: string,
  threadTs?: string
): Promise<void> {
  if (!slackApp) {
    throw new Error('Slack app not initialized');
  }

  try {
    const args: SayArguments = {
      channel: channelId,
      text: message,
      username: 'ClaudeClaw',
      icon_emoji: ':robot_face:',
    };

    if (threadTs) {
      args.thread_ts = threadTs;
    }

    await slackApp.client.chat.postMessage(args as any);
    logger.info({ channelId, threadTs }, 'Slack message sent');
  } catch (error) {
    logger.error({ error, channelId }, 'Failed to send Slack message');
    throw error;
  }
}

/**
 * Send a direct message to a user
 */
export async function sendSlackDM(userId: string, message: string): Promise<void> {
  if (!slackApp) {
    throw new Error('Slack app not initialized');
  }

  try {
    // Open a conversation with the user
    const conversation = await slackApp.client.conversations.open({
      users: userId,
    });

    await slackApp.client.chat.postMessage({
      channel: conversation.channel?.id || '',
      text: message,
      username: 'ClaudeClaw',
      icon_emoji: ':robot_face:',
    });

    logger.info({ userId }, 'Slack DM sent');
  } catch (error) {
    logger.error({ error, userId }, 'Failed to send Slack DM');
    throw error;
  }
}

/**
 * Get Slack app status
 */
export function getSlackStatus(): {
  initialized: boolean;
  ready: boolean;
} {
  return {
    initialized: slackApp !== null,
    ready: isReady,
  };
}

/**
 * Stop Slack app
 */
export async function stopSlack(): Promise<void> {
  if (slackApp) {
    await slackApp.stop();
    slackApp = null;
    isReady = false;
    logger.info('Slack app stopped');
  }
}

/**
 * Get user info
 */
export async function getSlackUserInfo(userId: string): Promise<{
  id: string;
  name: string;
  realName: string;
  email?: string;
} | null> {
  if (!slackApp) {
    return null;
  }

  try {
    const userInfo = await slackApp.client.users.info({ user: userId });
    return {
      id: userInfo.user?.id || '',
      name: userInfo.user?.name || '',
      realName: userInfo.user?.real_name || '',
      email: userInfo.user?.profile?.email,
    };
  } catch (error) {
    logger.error({ error, userId }, 'Failed to get Slack user info');
    return null;
  }
}
