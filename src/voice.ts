import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const env = readEnvFile();
const GROQ_API_KEY = env['GROQ_API_KEY'] ?? '';
const KOKORO_URL = env['KOKORO_URL'] ?? 'http://localhost:5000';
const VOICE_ENABLED = env['VOICE_ENABLED'] === 'true';

/**
 * Speech-to-text using Groq (Whisper)
 */
export async function speechToText(audioBuffer: Buffer): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY not configured');
  }

  const url = 'https://api.groq.com/openai/v1/audio/transcriptions';
  
  const formData = new FormData();
  const audioArray = new Uint8Array(audioBuffer);
  formData.append('file', new Blob([audioArray]), 'audio.webm');
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'en');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, 'Groq STT error');
    throw new Error(`Groq STT error ${response.status}: ${errorText.slice(0, 500)}`);
  }

  const data = await response.json() as { text?: string };
  return data.text ?? '';
}

/**
 * Text-to-speech using Kokoro
 */
export async function textToSpeech(text: string, voice: string = 'af_sarah'): Promise<Buffer> {
  const url = `${KOKORO_URL}/tts`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      voice,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, 'Kokoro TTS error');
    throw new Error(`Kokoro TTS error ${response.status}: ${errorText.slice(0, 500)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Check if voice is configured
 */
export function isVoiceConfigured(): boolean {
  return VOICE_ENABLED && !!GROQ_API_KEY;
}

/**
 * Get available voices from Kokoro
 */
export async function getAvailableVoices(): Promise<string[]> {
  try {
    const response = await fetch(`${KOKORO_URL}/voices`);
    if (!response.ok) {
      return [];
    }
    const data = await response.json() as { voices?: string[] };
    return data.voices ?? [];
  } catch (error) {
    logger.warn({ error }, 'Failed to get available voices');
    return [];
  }
}

/**
 * Generate voice message (returns audio buffer)
 */
export async function generateVoiceMessage(
  text: string,
  voice: string = 'af_sarah'
): Promise<Buffer> {
  if (!isVoiceConfigured()) {
    throw new Error('Voice not configured');
  }

  return textToSpeech(text, voice);
}

/**
 * Transcribe voice message
 */
export async function transcribeVoiceMessage(audioBuffer: Buffer): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY not configured');
  }

  return speechToText(audioBuffer);
}

/**
 * Get voice settings
 */
export function getVoiceSettings(): {
  enabled: boolean;
  provider: 'groq' | null;
  ttsUrl: string;
} {
  return {
    enabled: VOICE_ENABLED,
    provider: GROQ_API_KEY ? 'groq' : null,
    ttsUrl: KOKORO_URL,
  };
}

/**
 * Check Kokoro server health
 */
export async function checkKokoroHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${KOKORO_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch (error) {
    logger.warn({ error }, 'Kokoro health check failed');
    return false;
  }
}

/**
 * Check Groq STT health
 */
export async function checkGroqHealth(): Promise<boolean> {
  if (!GROQ_API_KEY) return false;
  
  try {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch (error) {
    logger.warn({ error }, 'Groq health check failed');
    return false;
  }
}

/**
 * Get overall voice health status
 */
export async function getVoiceHealthStatus(): Promise<{
  stt: boolean;
  tts: boolean;
  overall: 'healthy' | 'degraded' | 'failed';
}> {
  const stt = await checkGroqHealth();
  const tts = await checkKokoroHealth();

  let overall: 'healthy' | 'degraded' | 'failed' = 'failed';
  if (stt && tts) {
    overall = 'healthy';
  } else if (stt || tts) {
    overall = 'degraded';
  }

  return { stt, tts, overall };
}
