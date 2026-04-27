import whatsapp from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { logger } from './logger.js';
import { readEnvFile } from './env.js';
import { orchestrator } from './orchestrator.js';
import { isAuthorized } from './security.js';
import { checkPromptInjection, sanitizeInput } from './exfiltration-guard.js';
import { saveWAMessage } from './db.js';

const env = readEnvFile();
const { Client, LocalAuth, MessageMedia } = whatsapp;

let whatsappClient: InstanceType<typeof Client> | null = null;
let isReady = false;
let messageHandler: ((chatId: string, message: string, senderName: string) => Promise<void>) | null = null;

/**
 * Initialize WhatsApp client
 */
export async function initWhatsApp(
  onMessage?: (chatId: string, message: string, senderName: string) => Promise<void>
): Promise<InstanceType<typeof Client>> {
  if (whatsappClient) {
    logger.warn('WhatsApp client already initialized');
    return whatsappClient;
  }

  messageHandler = onMessage || null;

  whatsappClient = new Client({
    authStrategy: new LocalAuth({
      dataPath: env['WA_SESSION_PATH'] || '.wwebjs_auth',
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
  });

  whatsappClient.on('qr', (qr: string) => {
    logger.info('WhatsApp QR code received');
    console.log('\n📱 WhatsApp QR Code:\n');
    qrcode.generate(qr, { small: true });
    console.log('\nScan with WhatsApp to connect\n');
  });

  whatsappClient.on('authenticated', () => {
    logger.info('WhatsApp authenticated successfully');
  });

  whatsappClient.on('auth_failure', (error: Error) => {
    logger.error({ error }, 'WhatsApp authentication failed');
  });

  whatsappClient.on('disconnected', (reason: string) => {
    logger.warn({ reason }, 'WhatsApp disconnected');
    isReady = false;
  });

  whatsappClient.on('ready', () => {
    logger.info('WhatsApp client ready');
    isReady = true;
  });

  whatsappClient.on('message', async (message: any) => {
    await handleIncomingMessage(message);
  });

  await whatsappClient.initialize();
  return whatsappClient;
}

/**
 * Handle incoming WhatsApp messages
 */
async function handleIncomingMessage(message: any): Promise<void> {
  try {
    // Ignore status updates and group messages (unless configured)
    const chat = await message.getChat();
    
    if (chat.isGroup && env['WA_ALLOW_GROUPS']?.toLowerCase() !== 'true') {
      return;
    }

    // Ignore messages from self
    if (message.fromMe) {
      return;
    }

    const chatId = message.from;
    const senderName = message.author || message.from.split('@')[0];
    const messageText = message.body;

    // Save message to database
    saveWAMessage({
      message_id: message.id._serialized,
      chat_id: chatId,
      sender: senderName,
      message: messageText,
      timestamp: message.timestamp * 1000,
      direction: 'incoming',
    });

    // Check authorization
    if (!isAuthorized(chatId, 'whatsapp')) {
      logger.warn({ chatId, senderName }, 'Unauthorized WhatsApp message');
      await message.reply('Sorry, you are not authorized to use this bot.');
      return;
    }

    // Check for prompt injection
    if (checkPromptInjection(messageText)) {
      logger.warn({ chatId }, 'Prompt injection detected in WhatsApp message');
      await message.reply('Message rejected for security reasons.');
      return;
    }

    const sanitizedMessage = sanitizeInput(messageText);

    // Call message handler if provided
    if (messageHandler) {
      await messageHandler(chatId, sanitizedMessage, senderName);
    } else {
      // Default: process through orchestrator
      const result = await orchestrator.runWithContext(
        chatId,
        sanitizedMessage,
        'main',
        true
      );

      await message.reply(result.content);
    }

    // Save outgoing message
    saveWAMessage({
      message_id: `out_${Date.now()}`,
      chat_id: chatId,
      sender: 'ClaudeClaw',
      message: messageText,
      timestamp: Date.now(),
      direction: 'outgoing',
    });

    logger.info({ chatId, senderName, messageLength: messageText.length }, 'WhatsApp message processed');
  } catch (error) {
    logger.error({ error }, 'Error handling WhatsApp message');
  }
}

/**
 * Send a message via WhatsApp
 */
export async function sendWhatsAppMessage(chatId: string, message: string): Promise<void> {
  if (!whatsappClient || !isReady) {
    throw new Error('WhatsApp client not ready');
  }

  try {
    await whatsappClient.sendMessage(chatId, message);
    logger.info({ chatId, messageLength: message.length }, 'WhatsApp message sent');
  } catch (error) {
    logger.error({ error, chatId }, 'Failed to send WhatsApp message');
    throw error;
  }
}

/**
 * Send a message with media via WhatsApp
 */
export async function sendWhatsAppMedia(
  chatId: string,
  message: string,
  mediaPath: string
): Promise<void> {
  if (!whatsappClient || !isReady) {
    throw new Error('WhatsApp client not ready');
  }

  try {
    const media = MessageMedia.fromFilePath(mediaPath);
    await whatsappClient.sendMessage(chatId, media, { caption: message });
    logger.info({ chatId, mediaPath }, 'WhatsApp media sent');
  } catch (error) {
    logger.error({ error, chatId, mediaPath }, 'Failed to send WhatsApp media');
    throw error;
  }
}

/**
 * Get WhatsApp client status
 */
export function getWhatsAppStatus(): {
  initialized: boolean;
  ready: boolean;
  sessionExists: boolean;
} {
  return {
    initialized: whatsappClient !== null,
    ready: isReady,
    sessionExists: false, // Would need to check filesystem
  };
}

/**
 * Disconnect WhatsApp client
 */
export async function disconnectWhatsApp(): Promise<void> {
  if (whatsappClient) {
    await whatsappClient.destroy();
    whatsappClient = null;
    isReady = false;
    logger.info('WhatsApp client disconnected');
  }
}

/**
 * Get chat info
 */
export async function getChatInfo(chatId: string): Promise<{
  name: string;
  isGroup: boolean;
  participantCount?: number;
} | null> {
  if (!whatsappClient || !isReady) {
    return null;
  }

  try {
    const chat = await whatsappClient.getChatById(chatId);
    return {
      name: chat.name,
      isGroup: chat.isGroup,
      participantCount: chat.isGroup ? ((chat as any).participants?.length ?? undefined) : undefined,
    };
  } catch (error) {
    logger.error({ error, chatId }, 'Failed to get chat info');
    return null;
  }
}

/**
 * Mark message as read
 */
export async function markAsRead(messageId: string): Promise<void> {
  if (!whatsappClient || !isReady) {
    return;
  }

  try {
    const msg = await whatsappClient.getMessageById(messageId);
    if (msg) {
      await whatsappClient.sendSeen(msg.id.remote);
    }
  } catch (error) {
    logger.error({ error, messageId }, 'Failed to mark message as read');
  }
}

/**
 * Get contact info
 */
export async function getContactInfo(phoneNumber: string): Promise<{
  name: string;
  number: string;
  isMe: boolean;
} | null> {
  if (!whatsappClient || !isReady) {
    return null;
  }

  try {
    const contact = await whatsappClient.getContactById(`${phoneNumber}@c.us`);
    return {
      name: contact.pushname || contact.number,
      number: contact.number,
      isMe: contact.isMe,
    };
  } catch (error) {
    logger.error({ error, phoneNumber }, 'Failed to get contact info');
    return null;
  }
}
