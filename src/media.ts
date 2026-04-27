import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import { join } from 'path';
import { STORE_DIR } from './config.js';

const env = readEnvFile();
const MAX_AUDIO_SIZE = parseInt(env['MAX_AUDIO_SIZE'] ?? '20971520', 10); // 20MB default
const MAX_IMAGE_SIZE = parseInt(env['MAX_IMAGE_SIZE'] ?? '10485760', 10); // 10MB default

export type MediaType = 'audio' | 'image' | 'video' | 'document' | 'voice';

export interface MediaMetadata {
  type: MediaType;
  mimeType: string;
  size: number;
  duration?: number;
  width?: number;
  height?: number;
  fileName?: string;
}

/**
 * Process incoming media from Telegram
 */
export async function processTelegramMedia(
  fileId: string,
  mimeType: string
): Promise<{
  buffer: Buffer;
  metadata: MediaMetadata;
}> {
  // This would be implemented withgramJS's file download
  // For now, return placeholder
  throw new Error('Telegram media processing requires gramJS integration');
}

/**
 * Validate media file
 */
export function validateMedia(
  size: number,
  mimeType: string
): { valid: boolean; error?: string } {
  const type = getMediaType(mimeType);
  
  switch (type) {
    case 'audio':
    case 'voice':
      if (size > MAX_AUDIO_SIZE) {
        return { valid: false, error: `Audio too large (max ${MAX_AUDIO_SIZE / 1024 / 1024}MB)` };
      }
      break;
    case 'image':
      if (size > MAX_IMAGE_SIZE) {
        return { valid: false, error: `Image too large (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)` };
      }
      break;
    default:
      if (size > MAX_AUDIO_SIZE) {
        return { valid: false, error: `File too large (max ${MAX_AUDIO_SIZE / 1024 / 1024}MB)` };
      }
  }

  return { valid: true };
}

/**
 * Get media type from MIME type
 */
export function getMediaType(mimeType: string): MediaType {
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType === 'audio/ogg') return 'voice';
  return 'document';
}

/**
 * Download file from URL
 */
export async function downloadFile(url: string): Promise<Buffer> {
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Process image for vision analysis
 */
export async function processImageForVision(
  imageBuffer: Buffer
): Promise<string> {
  // Return base64 for vision API
  return imageBuffer.toString('base64');
}

/**
 * Get image dimensions
 */
export async function getImageDimensions(
  imageBuffer: Buffer
): Promise<{ width: number; height: number }> {
  // Simple PNG/JPEG dimension extraction
  // This is a simplified version - production would use sharp or similar
  
  if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50) {
    // PNG
    return {
      width: imageBuffer.readUInt32BE(16),
      height: imageBuffer.readUInt32BE(20),
    };
  }

  if (imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8) {
    // JPEG - simplified
    let offset = 2;
    while (offset < imageBuffer.length) {
      if (imageBuffer[offset] !== 0xFF) break;
      const marker = imageBuffer[offset + 1];
      if (marker === 0xC0 || marker === 0xC2) {
        return {
          height: imageBuffer.readUInt16BE(offset + 5),
          width: imageBuffer.readUInt16BE(offset + 7),
        };
      }
      const length = imageBuffer.readUInt16BE(offset + 2);
      offset += 2 + length;
    }
  }

  return { width: 0, height: 0 };
}

/**
 * Convert audio to standard format
 */
export async function convertAudioFormat(
  inputBuffer: Buffer,
  inputFormat: string,
  outputFormat: string = 'webm'
): Promise<Buffer> {
  // This would use ffmpeg in production
  // For now, return as-is
  logger.warn({ inputFormat, outputFormat }, 'Audio conversion not implemented, returning original');
  return inputBuffer;
}

/**
 * Generate media thumbnail
 */
export async function generateThumbnail(
  imageBuffer: Buffer,
  maxSize: number = 256
): Promise<Buffer> {
  // This would use sharp in production
  logger.warn('Thumbnail generation not implemented');
  return imageBuffer;
}

/**
 * Clean up temporary media files
 */
export function cleanupMedia(tempPaths: string[]): void {
  // Would delete temp files
  logger.debug({ count: tempPaths.length }, 'Cleaning up temporary media');
}

/**
 * Get media storage path
 */
export function getMediaStoragePath(chatId: string, messageId: number): string {
  return join(STORE_DIR, 'media', chatId, `${messageId}`);
}

/**
 * Save media to storage
 */
export async function saveMediaToStorage(
  buffer: Buffer,
  chatId: string,
  messageId: number,
  mimeType: string
): Promise<string> {
  const { mkdir, writeFile } = await import('fs/promises');
  const path = getMediaStoragePath(chatId, messageId);
  
  await mkdir(path, { recursive: true });
  
  const ext = mimeType.split('/')[1] ?? 'bin';
  const filePath = `${path}/media.${ext}`;
  
  await writeFile(filePath, buffer);
  
  return filePath;
}
