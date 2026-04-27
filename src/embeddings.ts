import { getMemoriesByChat } from './db.js';
import { logger } from './logger.js';

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same dimension');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitudeA = Math.sqrt(normA);
  const magnitudeB = Math.sqrt(normB);

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Convert embedding array to Buffer for SQLite storage
 */
export function embeddingToBuffer(embedding: number[]): Buffer {
  const float32 = new Float32Array(embedding);
  return Buffer.from(float32.buffer);
}

/**
 * Convert Buffer back to embedding array
 */
export function bufferToEmbedding(buffer: Buffer): number[] {
  const float32 = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
  return Array.from(float32);
}

/**
 * Find similar memories using cosine similarity
 */
export async function findSimilarMemories(
  chatId: string,
  queryEmbedding: number[],
  limit: number = 5,
  threshold: number = 0.3,
  agentId: string = 'main'
): Promise<Array<{ id: number; content: string; similarity: number; importance: number }>> {
  const memories = getMemoriesByChat(chatId, 100, agentId);
  
  const results: Array<{ id: number; content: string; similarity: number; importance: number }> = [];
  
  for (const memory of memories) {
    if (!memory.embedding) continue;
    
    const storedEmbedding = bufferToEmbedding(memory.embedding);
    const similarity = cosineSimilarity(queryEmbedding, storedEmbedding);
    
    if (similarity >= threshold) {
      results.push({
        id: memory.id,
        content: memory.summary,
        similarity,
        importance: memory.importance,
      });
    }
  }
  
  // Sort by similarity descending
  results.sort((a, b) => b.similarity - a.similarity);
  
  // Return top N
  return results.slice(0, limit);
}

/**
 * Check if a new memory is a duplicate (too similar to existing)
 */
export async function isDuplicateMemory(
  chatId: string,
  newEmbedding: number[],
  threshold: number = 0.85,
  agentId: string = 'main'
): Promise<{ isDuplicate: boolean; existingId?: number; similarity: number }> {
  const memories = getMemoriesByChat(chatId, 50, agentId);
  
  for (const memory of memories) {
    if (!memory.embedding) continue;
    
    const storedEmbedding = bufferToEmbedding(memory.embedding);
    const similarity = cosineSimilarity(newEmbedding, storedEmbedding);
    
    if (similarity >= threshold) {
      return {
        isDuplicate: true,
        existingId: memory.id,
        similarity,
      };
    }
  }
  
  return { isDuplicate: false, similarity: 0 };
}

/**
 * Check if new memory contradicts existing memory (for supersession)
 */
export async function checkForContradiction(
  chatId: string,
  newSummary: string,
  agentId: string = 'main'
): Promise<{ hasContradiction: boolean; existingId?: number; description?: string }> {
  // This is a simple heuristic - in production you'd use LLM to detect contradictions
  // For now, we look for direct opposites in the summary text
  
  const contradictionPairs = [
    ['prefer', 'dont prefer'],
    ['like', 'dislike'],
    ['use', 'dont use'],
    ['love', 'hate'],
    ['always', 'never'],
  ];

  const memories = getMemoriesByChat(chatId, 20, agentId);
  
  const newLower = newSummary.toLowerCase();
  
  for (const memory of memories) {
    if (!memory.summary) continue;
    
    const existingLower = memory.summary.toLowerCase();
    
    for (const [positive, negative] of contradictionPairs) {
      if (newLower.includes(positive) && existingLower.includes(negative)) {
        return {
          hasContradiction: true,
          existingId: memory.id,
          description: `Found contradiction: "${positive}" vs "${negative}"`,
        };
      }
      if (newLower.includes(negative) && existingLower.includes(positive)) {
        return {
          hasContradiction: true,
          existingId: memory.id,
          description: `Found contradiction: "${negative}" vs "${positive}"`,
        };
      }
    }
  }
  
  return { hasContradiction: false };
}