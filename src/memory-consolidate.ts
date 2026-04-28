import { callGemini } from './gemini.js';
import { 
  getUnconsolidatedMemories, 
  saveConsolidation, 
  markMemoriesConsolidated, 
  getRecentConsolidations,
  Memory,
  Consolidation 
} from './db.js';
import { logger } from './logger.js';
import { readEnvFile } from './env.js';
import { publishDashboardEvent } from './dashboard.js';

const env = readEnvFile();
const CONSOLIDATION_INTERVAL_MS = parseInt(env['CONSOLIDATION_INTERVAL_MS'] ?? '3600000', 10); // 1 hour default
const MIN_MEMORIES_TO_CONSOLIDATE = parseInt(env['MIN_MEMORIES_TO_CONSOLIDATE'] ?? '10', 10);

/**
 * Consolidate multiple memories into a higher-level summary
 */
export async function runConsolidation(
  chatId: string,
  agentId: string = 'main'
): Promise<Consolidation | null> {
  const memories = getUnconsolidatedMemories(chatId, MIN_MEMORIES_TO_CONSOLIDATE, agentId);
  
  if (memories.length < 3) {
    logger.debug({ chatId, count: memories.length }, 'Not enough memories to consolidate');
    return null;
  }

  logger.info({ chatId, count: memories.length }, 'Starting memory consolidation');

  // Build context from memories
  const memoryTexts = memories.map((m, i) => 
    `${i + 1}. ${m.summary}${m.entities ? ` (Entities: ${m.entities})` : ''}`
  ).join('\n\n');

  const recentConsolidations = getRecentConsolidations(chatId, 3);
  const consolidationContext = recentConsolidations.length > 0
    ? `Previous consolidations:\n${recentConsolidations.map(c => `- ${c.summary}`).join('\n')}`
    : '';

  const systemPrompt = `You are a memory consolidation system. Your job is to:
1. Combine multiple memory fragments into a coherent summary
2. Identify connections between different pieces of information
3. Detect any contradictions or conflicts
4. Extract key insights that emerge from the combination

Respond in JSON format:
{
  "summary": "A comprehensive summary combining all the memories",
  "insight": "Any new insight that emerges from combining these memories",
  "connections": "How these memories relate to each other",
  "contradictions": "Any contradictions found (or 'none')"
}`;

  const userPrompt = `Memories to consolidate:
${memoryTexts}

${consolidationContext}

Analyze these memories and create a consolidated summary.`;

  try {
    const response = await callGemini(userPrompt, systemPrompt);
    
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn({ response }, 'Failed to parse consolidation response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    const consolidation: Omit<Consolidation, 'id'> = {
      chat_id: chatId,
      summary: parsed.summary ?? '',
      insight: parsed.insight ?? null,
      connections: parsed.connections ?? null,
      contradictions: parsed.contradictions ?? null,
      source_memory_ids: JSON.stringify(memories.map(m => m.id)),
      created_at: Date.now(),
    };

    const consolidationId = saveConsolidation(consolidation);
    
    // Mark source memories as consolidated
    markMemoriesConsolidated(memories.map(m => m.id));

    logger.info({ consolidationId, chatId, memoryCount: memories.length }, 'Consolidation complete');
    
    publishDashboardEvent('memory.consolidated', { id: consolidationId, chatId, memoryCount: memories.length });

    return { ...consolidation, id: consolidationId };
  } catch (error) {
    logger.error({ error, chatId }, 'Consolidation failed');
    return null;
  }
}

/**
 * Start the automatic consolidation loop
 */
let consolidationInterval: ReturnType<typeof setInterval> | null = null;

export function startConsolidationLoop(): void {
  if (consolidationInterval) {
    logger.warn('Consolidation loop already running');
    return;
  }

  logger.info({ interval: CONSOLIDATION_INTERVAL_MS }, 'Starting consolidation loop');

  const runScheduledConsolidation = async () => {
    try {
      // Get all chats with unconsolidated memories
      // This is a simplified approach - in production you'd track this more efficiently
      const chats = new Set<string>();
      
      // For now, we'll just log that consolidation would run
      // In production, you'd query for chats with pending memories
      logger.debug('Running scheduled consolidation check');
      
      // TODO: Implement chat-scoped consolidation
      // For each chat with >= MIN_MEMORIES_TO_CONSOLIDATE unconsolidated memories
      // await runConsolidation(chatId);
      
    } catch (error) {
      logger.error({ error }, 'Scheduled consolidation failed');
    }
  };

  consolidationInterval = setInterval(runScheduledConsolidation, CONSOLIDATION_INTERVAL_MS);
}

export function stopConsolidationLoop(): void {
  if (consolidationInterval) {
    clearInterval(consolidationInterval);
    consolidationInterval = null;
    logger.info('Consolidation loop stopped');
  }
}

/**
 * Manually trigger consolidation for a specific chat
 */
export async function triggerConsolidation(
  chatId: string,
  agentId: string = 'main'
): Promise<boolean> {
  try {
    const result = await runConsolidation(chatId, agentId);
    return result !== null;
  } catch (error) {
    logger.error({ error, chatId }, 'Manual consolidation trigger failed');
    return false;
  }
}

/**
 * Get consolidation history for a chat
 */
export function getConsolidationHistory(
  chatId: string,
  limit: number = 10
): Consolidation[] {
  return getRecentConsolidations(chatId, limit);
}