import { callGemini, getEmbedding } from './gemini.js';
import { saveMemory, getUnconsolidatedMemories, Memory } from './db.js';
import { embeddingToBuffer, isDuplicateMemory, checkForContradiction } from './embeddings.js';
import { logger } from './logger.js';
import { readEnvFile } from './env.js';
import { publishDashboardEvent } from './dashboard.js';

const env = readEnvFile();
const MEMORY_EXTRACTION_ENABLED = env['MEMORY_EXTRACTION_ENABLED'] !== 'false';

/**
 * Extract structured memory from conversation turn using Gemini
 */
export async function extractMemoryFromTurn(
  chatId: string,
  userMessage: string,
  assistantMessage: string,
  agentId: string = 'main'
): Promise<{
  summary: string;
  entities: string[];
  topics: string[];
  connections: string[];
  importance: number;
  salience: number;
} | null> {
  if (!MEMORY_EXTRACTION_ENABLED) {
    logger.debug('Memory extraction disabled, skipping');
    return null;
  }

  const systemPrompt = `You are a memory extraction system. Analyze the conversation and extract key information to store as memory.

Extract the following:
1. summary: A 1-2 sentence summary of the key information from this conversation turn
2. entities: List of specific entities mentioned (names, places, products, etc.)
3. topics: List of topics or subjects discussed
4. connections: How this relates to previous knowledge (or "none" if new)
5. importance: Score from 0-1 based on how important this information is likely to be long-term
6. salience: Score from 0-10 based on how recently/topically relevant this is

Respond in JSON format:
{
  "summary": "...",
  "entities": ["..."],
  "topics": ["..."],
  "connections": "...",
  "importance": 0.0-1.0,
  "salience": 0-10
}`;

  const userPrompt = `Conversation:
User: ${userMessage}
Assistant: ${assistantMessage}`;

  try {
    const response = await callGemini(userPrompt, systemPrompt);
    
    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn({ response }, 'Failed to parse memory extraction response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    return {
      summary: parsed.summary ?? '',
      entities: parsed.entities ?? [],
      topics: parsed.topics ?? [],
      connections: parsed.connections ?? 'none',
      importance: Math.min(1, Math.max(0, parsed.importance ?? 0.5)),
      salience: Math.min(10, Math.max(0, parsed.salience ?? 5)),
    };
  } catch (error) {
    logger.error({ error }, 'Memory extraction failed');
    return null;
  }
}

/**
 * Ingest a conversation turn into memory
 */
export async function ingestConversationTurn(
  chatId: string,
  userMessage: string,
  assistantMessage: string,
  agentId: string = 'main'
): Promise<number | null> {
  const now = Date.now();
  
  // Extract structured memory
  const extracted = await extractMemoryFromTurn(chatId, userMessage, assistantMessage, agentId);
  
  if (!extracted) {
    // Fallback: store raw text if extraction fails
    const rawText = `User: ${userMessage}\nAssistant: ${assistantMessage}`;
    
    const memoryId = saveMemory({
      chat_id: chatId,
      agent_id: agentId,
      source: 'conversation',
      raw_text: rawText,
      summary: userMessage.slice(0, 100),
      entities: null,
      topics: null,
      connections: null,
      importance: 0.3,
      salience: 5,
      consolidated: 0,
      pinned: 0,
      embedding: null,
      superseded_by: null,
      created_at: now,
      accessed_at: now,
    });
    
    logger.debug({ memoryId, chatId }, 'Stored fallback memory');
    publishDashboardEvent('memory.created', { id: memoryId, chatId, agentId, importance: 0.3 });
    return memoryId;
  }

  // Generate embedding for the summary
  let embeddingBuffer: Buffer | null = null;
  try {
    const embedding = await getEmbedding(extracted.summary);
    embeddingBuffer = embeddingToBuffer(embedding);
  } catch (error) {
    logger.warn({ error }, 'Failed to generate embedding for memory');
  }

  // Check for duplicates
  if (embeddingBuffer) {
    const duplicateCheck = await isDuplicateMemory(chatId, await getEmbedding(extracted.summary));
    if (duplicateCheck.isDuplicate) {
      logger.debug({ existingId: duplicateCheck.existingId }, 'Skipping duplicate memory');
      return null;
    }

    // Check for contradictions
    const contradictionCheck = await checkForContradiction(chatId, extracted.summary, agentId);
    if (contradictionCheck.hasContradiction && contradictionCheck.existingId) {
      logger.info({ 
        existingId: contradictionCheck.existingId,
        description: contradictionCheck.description 
      }, 'Memory contradicts existing, will supersede');
    }
  }

  // Save the memory
  const memoryId = saveMemory({
    chat_id: chatId,
    agent_id: agentId,
    source: 'conversation',
    raw_text: `User: ${userMessage}\nAssistant: ${assistantMessage}`,
    summary: extracted.summary,
    entities: JSON.stringify(extracted.entities),
    topics: JSON.stringify(extracted.topics),
    connections: JSON.stringify(extracted.connections),
    importance: extracted.importance,
    salience: extracted.salience,
    consolidated: 0,
    pinned: 0,
    embedding: embeddingBuffer,
    superseded_by: null,
    created_at: now,
    accessed_at: now,
  });

  logger.debug({ memoryId, chatId, importance: extracted.importance }, 'Memory ingested');
  publishDashboardEvent('memory.created', { id: memoryId, chatId, agentId, importance: extracted.importance });
  return memoryId;
}

/**
 * Ingest a system message or note into memory
 */
export async function ingestSystemMessage(
  chatId: string,
  content: string,
  importance: number = 0.7,
  agentId: string = 'main'
): Promise<number> {
  const now = Date.now();
  
  let embeddingBuffer: Buffer | null = null;
  try {
    const embedding = await getEmbedding(content);
    embeddingBuffer = embeddingToBuffer(embedding);
  } catch (error) {
    logger.warn({ error }, 'Failed to generate embedding for system message');
  }

  const memoryId = saveMemory({
    chat_id: chatId,
    agent_id: agentId,
    source: 'system',
    raw_text: content,
    summary: content.slice(0, 200),
    entities: null,
    topics: null,
    connections: null,
    importance,
    salience: 10,
    consolidated: 0,
    pinned: 1, // System messages are pinned by default
    embedding: embeddingBuffer,
    superseded_by: null,
    created_at: now,
    accessed_at: now,
  });

  logger.debug({ memoryId, chatId }, 'System message ingested');
  return memoryId;
}

/**
 * Ingest a user preference into memory
 */
export async function ingestPreference(
  chatId: string,
  preference: string,
  agentId: string = 'main'
): Promise<number> {
  const now = Date.now();
  
  let embeddingBuffer: Buffer | null = null;
  try {
    const embedding = await getEmbedding(preference);
    embeddingBuffer = embeddingToBuffer(embedding);
  } catch (error) {
    logger.warn({ error }, 'Failed to generate embedding for preference');
  }

  const memoryId = saveMemory({
    chat_id: chatId,
    agent_id: agentId,
    source: 'preference',
    raw_text: preference,
    summary: preference,
    entities: null,
    topics: null,
    connections: null,
    importance: 0.8, // Preferences are high importance
    salience: 8,
    consolidated: 0,
    pinned: 1, // Preferences are pinned
    embedding: embeddingBuffer,
    superseded_by: null,
    created_at: now,
    accessed_at: now,
  });

  logger.debug({ memoryId, chatId }, 'Preference ingested');
  return memoryId;
}

/**
 * Get memory statistics for a chat
 */
export function getMemoryStats(chatId: string, agentId: string = 'main'): {
  total: number;
  unconsolidated: number;
  pinned: number;
  avgImportance: number;
} {
  const memories = getUnconsolidatedMemories(chatId, 1000, agentId);
  
  const total = memories.length;
  const unconsolidated = memories.filter(m => m.consolidated === 0).length;
  const pinned = memories.filter(m => m.pinned === 1).length;
  const avgImportance = total > 0 
    ? memories.reduce((sum, m) => sum + m.importance, 0) / total 
    : 0;

  return { total, unconsolidated, pinned, avgImportance };
}
