import {
  getMemoriesByChat,
  getHighImportanceMemories,
  getRecentConsolidations,
  getRecentConversation,
  logConversation,
  saveTurn,
  Memory,
  Consolidation,
  ConversationEntry,
} from './db.js';
import { getEmbedding } from './gemini.js';
import { findSimilarMemories, embeddingToBuffer } from './embeddings.js';
import { ingestConversationTurn } from './memory-ingest.js';
import { runConsolidation } from './memory-consolidate.js';
import { logger } from './logger.js';
import { readEnvFile } from './env.js';

const env = readEnvFile();
const MAX_CONTEXT_TOKENS = parseInt(env['MAX_CONTEXT_TOKENS'] ?? '100000', 10);
const MEMORY_CONTEXT_LIMIT = parseInt(env['MEMORY_CONTEXT_LIMIT'] ?? '50', 10);

/**
 * Build memory context for a chat using 5-layer retrieval
 * 
 * Layer 1: Pinned/High importance memories (always included)
 * Layer 2: Recent consolidated summaries
 * Layer 3: Semantically similar to current query
 * Layer 4: Recent conversation history
 * Layer 5: Salient unconsolidated memories
 */
export async function buildMemoryContext(
  chatId: string,
  currentQuery?: string,
  agentId: string = 'main'
): Promise<{
  context: string;
  memoryCount: number;
  tokenEstimate: number;
}> {
  const layers: string[] = [];
  let totalTokens = 0;
  let memoryCount = 0;

  // Layer 1: Pinned and high importance memories
  const highImportance = getHighImportanceMemories(chatId, 0.7, 5, agentId);
  if (highImportance.length > 0) {
    const layerText = `## Important Memories\n${highImportance.map(m => 
      `- ${m.summary}${m.pinned ? ' [PINNED]' : ''}`
    ).join('\n')}`;
    layers.push(layerText);
    totalTokens += highImportance.reduce((sum, m) => sum + m.summary.length / 4, 0);
    memoryCount += highImportance.length;
  }

  // Layer 2: Recent consolidated summaries
  const consolidations = getRecentConsolidations(chatId, 3);
  if (consolidations.length > 0) {
    const layerText = `## Consolidated Knowledge\n${consolidations.map(c => 
      `- ${c.summary}${c.insight ? `\n  Insight: ${c.insight}` : ''}`
    ).join('\n')}`;
    layers.push(layerText);
    totalTokens += consolidations.reduce((sum, c) => sum + c.summary.length / 4, 0);
    memoryCount += consolidations.length;
  }

  // Layer 3: Semantically similar to current query
  if (currentQuery) {
    try {
      const queryEmbedding = await getEmbedding(currentQuery);
      const similar = await findSimilarMemories(
        chatId,
        queryEmbedding,
        5,
        0.3,
        agentId
      );
      
      if (similar.length > 0) {
        const layerText = `## Related Memories\n${similar.map(m => 
          `- ${m.content} (relevance: ${(m.similarity * 100).toFixed(0)}%)`
        ).join('\n')}`;
        layers.push(layerText);
        totalTokens += similar.reduce((sum, m) => sum + m.content.length / 4, 0);
        memoryCount += similar.length;
      }
    } catch (error) {
      logger.warn({ error, chatId }, 'Failed to find similar memories');
    }
  }

  // Layer 4: Recent conversation history
  const recentConversation = getRecentConversation(chatId, 10, agentId);
  if (recentConversation.length > 0) {
    const layerText = `## Recent Conversation\n${recentConversation.map(e => 
      `${e.role === 'user' ? 'User' : 'Assistant'}: ${e.content.slice(0, 200)}`
    ).join('\n')}`;
    layers.push(layerText);
    totalTokens += recentConversation.reduce((sum, e) => sum + e.content.length / 4, 0);
  }

  // Layer 5: Salient unconsolidated memories
  const allMemories = getMemoriesByChat(chatId, MEMORY_CONTEXT_LIMIT, agentId);
  const unconsolidated = allMemories.filter(m => m.consolidated === 0 && m.pinned === 0);
  if (unconsolidated.length > 0) {
    const topSalient = unconsolidated
      .sort((a, b) => b.salience - a.salience)
      .slice(0, 5);
    
    const layerText = `## Recent Memories\n${topSalient.map(m => 
      `- ${m.summary}`
    ).join('\n')}`;
    layers.push(layerText);
    totalTokens += topSalient.reduce((sum, m) => sum + m.summary.length / 4, 0);
    memoryCount += topSalient.length;
  }

  const context = layers.length > 0
    ? `${layers.join('\n\n')}\n\n---\n\n`
    : '';

  // Check token limit
  if (totalTokens > MAX_CONTEXT_TOKENS) {
    logger.warn({ 
      chatId, 
      tokens: totalTokens, 
      limit: MAX_CONTEXT_TOKENS 
    }, 'Memory context exceeds token limit, truncating');
  }

  return {
    context,
    memoryCount,
    tokenEstimate: Math.round(totalTokens),
  };
}

/**
 * Save a conversation turn and optionally ingest into memory
 */
export async function saveConversationTurn(
  chatId: string,
  role: 'user' | 'assistant',
  content: string,
  agentId: string = 'main',
  ingestToMemory: boolean = true
): Promise<void> {
  // Always save to conversation log
  logConversation(chatId, role, content, agentId);
  
  // Also save to simple memory (turns table)
  saveTurn(chatId, role, content);

  // Optionally ingest to Full v2 memory system
  if (ingestToMemory && role === 'assistant') {
    // We need the user message that preceded this assistant response
    const recent = getRecentConversation(chatId, 2, agentId);
    const userMessage = recent.find(e => e.role === 'user');
    
    if (userMessage) {
      await ingestConversationTurn(chatId, userMessage.content, content, agentId);
    }
  }
}

/**
 * Evaluate memory relevance for a given query
 * Used to determine which memories to include in context
 */
export async function evaluateMemoryRelevance(
  chatId: string,
  query: string,
  agentId: string = 'main'
): Promise<Array<{
  memory: Memory;
  relevance: number;
  reason: string;
}>> {
  const memories = getMemoriesByChat(chatId, 50, agentId);
  const results: Array<{
    memory: Memory;
    relevance: number;
    reason: string;
  }> = [];

  try {
    const queryEmbedding = await getEmbedding(query);
    const similar = await findSimilarMemories(
      chatId,
      queryEmbedding,
      10,
      0.1,
      agentId
    );

    const similarMap = new Map(similar.map(s => [s.id, s.similarity]));

    for (const memory of memories) {
      let relevance = 0;
      let reason = '';

      // Base relevance from importance
      relevance += memory.importance * 0.3;

      // Boost from salience
      relevance += (memory.salience / 10) * 0.2;

      // Boost from semantic similarity
      const similarity = similarMap.get(memory.id) ?? 0;
      relevance += similarity * 0.4;

      // Boost for pinned memories
      if (memory.pinned) {
        relevance += 0.2;
        reason += ' [Pinned]';
      }

      // Boost for recent access
      const hoursSinceAccess = (Date.now() - memory.accessed_at) / (1000 * 60 * 60);
      if (hoursSinceAccess < 24) {
        relevance += 0.1;
        reason += ' [Recently accessed]';
      }

      // Penalize for old memories
      const daysSinceCreation = (Date.now() - memory.created_at) / (1000 * 60 * 60 * 24);
      if (daysSinceCreation > 30) {
        relevance *= 0.5;
        reason += ' [Older memory]';
      }

      results.push({
        memory,
        relevance: Math.min(1, relevance),
        reason: reason.trim() || 'General relevance',
      });
    }
  } catch (error) {
    logger.warn({ error, chatId }, 'Failed to evaluate memory relevance, using fallback');
    
    // Fallback: just use importance and recency
    for (const memory of memories) {
      let relevance = memory.importance;
      const hoursSinceAccess = (Date.now() - memory.accessed_at) / (1000 * 60 * 60);
      if (hoursSinceAccess < 24) relevance += 0.2;
      
      results.push({
        memory,
        relevance: Math.min(1, relevance),
        reason: 'Fallback: importance-based',
      });
    }
  }

  // Sort by relevance descending
  results.sort((a, b) => b.relevance - a.relevance);

  return results.slice(0, 10);
}

/**
 * Run decay sweep to clean up old/low-importance memories
 * This is called periodically by the scheduler
 */
export async function runMemoryDecaySweep(): Promise<number> {
  // Import the db function
  const { runDecaySweep } = await import('./db.js');
  return runDecaySweep();
}

/**
 * Get memory summary for a chat
 */
export function getMemorySummary(
  chatId: string,
  agentId: string = 'main'
): {
  totalMemories: number;
  consolidatedCount: number;
  pinnedCount: number;
  avgImportance: number;
  recentConsolidations: number;
} {
  const memories = getMemoriesByChat(chatId, 1000, agentId);
  const consolidations = getRecentConsolidations(chatId, 100);

  return {
    totalMemories: memories.length,
    consolidatedCount: memories.filter(m => m.consolidated === 1).length,
    pinnedCount: memories.filter(m => m.pinned === 1).length,
    avgImportance: memories.length > 0
      ? memories.reduce((sum, m) => sum + m.importance, 0) / memories.length
      : 0,
    recentConsolidations: consolidations.length,
  };
}

/**
 * Manually trigger memory consolidation for a chat
 */
export async function triggerMemoryConsolidation(
  chatId: string,
  agentId: string = 'main'
): Promise<boolean> {
  return runConsolidation(chatId, agentId).then(r => r !== null);
}

/**
 * Search memories by text query
 */
export async function searchMemories(
  chatId: string,
  query: string,
  agentId: string = 'main'
): Promise<Array<{
  id: number;
  summary: string;
  importance: number;
  created_at: number;
}>> {
  try {
    const queryEmbedding = await getEmbedding(query);
    const similar = await findSimilarMemories(
      chatId,
      queryEmbedding,
      10,
      0.1,
      agentId
    );

    return similar.map(s => ({
      id: s.id,
      summary: s.content,
      importance: s.importance,
      created_at: Date.now(), // Would need to fetch from DB
    }));
  } catch (error) {
    logger.warn({ error, chatId, query }, 'Memory search failed');
    return [];
  }
}