import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const env = readEnvFile();
const GOOGLE_API_KEY = env['GOOGLE_API_KEY'] ?? '';

const GEMINI_TEXT_MODEL = 'gemini-3-flash-preview';
const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';

/**
 * Call Gemini API for text generation
 */
export async function callGemini(
  prompt: string,
  systemInstruction?: string
): Promise<string> {
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY not configured');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${GOOGLE_API_KEY}`;
  
  const body: Record<string, unknown> = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
    }
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, 'Gemini API error');
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
    promptFeedback?: {
      blockReason?: string;
    };
  };

  // Check for blocked content
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Content blocked: ${data.promptFeedback.blockReason}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!text) {
    throw new Error('No response from Gemini');
  }

  return text;
}

/**
 * Get embedding vector for text using Gemini
 */
export async function getEmbedding(text: string): Promise<number[]> {
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY not configured');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${GOOGLE_API_KEY}`;
  
  const body = {
    content: {
      parts: [{ text }]
    },
    taskType: 'SEMANTIC_SIMILARITY'
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, 'Gemini embedding API error');
    throw new Error(`Gemini embedding API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as {
    embedding?: {
      values?: number[];
    };
  };

  const values = data.embedding?.values;
  
  if (!values || !Array.isArray(values)) {
    throw new Error('No embedding returned from Gemini');
  }

  return values;
}

/**
 * Check if Gemini is configured and available
 */
export function isGeminiConfigured(): boolean {
  return !!GOOGLE_API_KEY;
}