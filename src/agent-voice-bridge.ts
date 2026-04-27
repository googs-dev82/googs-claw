import WebSocket from 'ws';
import { logger } from './logger.js';
import { readEnvFile } from './env.js';
import { orchestrator } from './orchestrator.js';

const env = readEnvFile();

let wsClient: WebSocket | null = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Connect to War Room voice server
 */
export function connectToWarRoom(): void {
  const warroomUrl = env['WARROOM_WS_URL'] || 'ws://localhost:8765';
  
  if (wsClient && isConnected) {
    logger.warn('Already connected to War Room');
    return;
  }

  logger.info({ url: warroomUrl }, 'Connecting to War Room');

  wsClient = new WebSocket(warroomUrl);

  wsClient.on('open', () => {
    isConnected = true;
    reconnectAttempts = 0;
    logger.info('Connected to War Room');
  });

  wsClient.on('message', async (data: WebSocket.Data) => {
    try {
      const message = JSON.parse(data.toString());
      await handleWarRoomMessage(message);
    } catch (error) {
      logger.error({ error }, 'Error parsing War Room message');
    }
  });

  wsClient.on('close', () => {
    isConnected = false;
    logger.warn('War Room disconnected');
    attemptReconnect();
  });

  wsClient.on('error', (error) => {
    logger.error({ error }, 'War Room connection error');
  });
}

/**
 * Handle incoming War Room messages
 */
async function handleWarRoomMessage(message: any): Promise<void> {
  switch (message.type) {
    case 'transcription':
      await handleTranscription(message.text);
      break;
    case 'audio':
      // Handle incoming audio (for visualization or logging)
      logger.debug({ timestamp: message.timestamp }, 'Received audio data');
      break;
    case 'status':
      logger.info({ status: message.status }, 'War Room status update');
      break;
    default:
      logger.warn({ type: message.type }, 'Unknown War Room message type');
  }
}

/**
 * Handle transcribed text from voice input
 */
async function handleTranscription(text: string): Promise<void> {
  if (!text.trim()) return;

  logger.info({ text }, 'Processing voice transcription');

  try {
    // Process through orchestrator
    const result = await orchestrator.runWithContext(
      'warroom',
      text,
      'main',
      true // include memory
    );

    // Send response back to War Room
    await sendToWarRoom({
      type: 'text',
      text: result.content,
    });

    // If voice output enabled, also generate speech
    if (env['WARROOM_VOICE_OUTPUT']?.toLowerCase() === 'true') {
      // Voice output would be handled by the voice module
      logger.debug({ text: result.content }, 'Voice output requested');
    }

    logger.info({ responseLength: result.content.length }, 'Voice query processed');
  } catch (error) {
    logger.error({ error }, 'Error processing voice transcription');
    await sendToWarRoom({
      type: 'error',
      text: 'Sorry, I encountered an error processing your request.',
    });
  }
}

/**
 * Send message to War Room
 */
export async function sendToWarRoom(message: object): Promise<void> {
  if (!wsClient || !isConnected) {
    logger.warn('Not connected to War Room');
    return;
  }

  return new Promise((resolve, reject) => {
    wsClient!.send(JSON.stringify(message), (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Send text to War Room for TTS playback
 */
export async function sendTextToWarRoom(text: string): Promise<void> {
  await sendToWarRoom({
    type: 'text',
    text,
  });
}

/**
 * Send audio data to War Room for playback
 */
export async function sendAudioToWarRoom(audioData: Buffer): Promise<void> {
  await sendToWarRoom({
    type: 'audio_response',
    data: audioData.toString('base64'),
  });
}

/**
 * Start voice recording in War Room
 */
export async function startWarRoomRecording(): Promise<void> {
  await sendToWarRoom({
    type: 'start_recording',
  });
  logger.info('War Room recording started');
}

/**
 * Stop voice recording in War Room
 */
export async function stopWarRoomRecording(): Promise<void> {
  await sendToWarRoom({
    type: 'stop_recording',
  });
  logger.info('War Room recording stopped');
}

/**
 * Attempt to reconnect to War Room
 */
function attemptReconnect(): void {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logger.error('Max reconnection attempts reached for War Room');
    return;
  }

  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
  
  logger.info({ attempt: reconnectAttempts, delay }, 'Attempting to reconnect to War Room');
  
  setTimeout(() => {
    connectToWarRoom();
  }, delay);
}

/**
 * Disconnect from War Room
 */
export function disconnectFromWarRoom(): void {
  if (wsClient) {
    wsClient.close();
    wsClient = null;
    isConnected = false;
    logger.info('Disconnected from War Room');
  }
}

/**
 * Get War Room connection status
 */
export function getWarRoomStatus(): {
  connected: boolean;
  reconnectAttempts: number;
} {
  return {
    connected: isConnected,
    reconnectAttempts,
  };
}

/**
 * Send a message to War Room and wait for response
 */
export async function sendMessageAndWait(text: string, timeout: number = 30000): Promise<string> {
  // Send the message
  await sendToWarRoom({
    type: 'text',
    text,
  });

  // Wait for response (this is a simplified version)
  // In production, you'd want proper request/response correlation
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('War Room response timeout'));
    }, timeout);

    if (wsClient) {
      wsClient.once('message', (data: WebSocket.Data) => {
        clearTimeout(timeoutId);
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'text' || message.type === 'transcription') {
            resolve(message.text);
          } else {
            resolve('');
          }
        } catch {
          reject(new Error('Failed to parse War Room response'));
        }
      });
    }
  });
}

/**
 * Initialize War Room bridge
 */
export function initWarRoomBridge(): void {
  const warroomEnabled = env['WARROOM_ENABLED']?.toLowerCase() === 'true';
  
  if (warroomEnabled) {
    connectToWarRoom();
  } else {
    logger.info('War Room bridge disabled');
  }
}
