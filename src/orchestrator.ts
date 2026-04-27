import { createAgentRuntime, runAgent, AgentResult } from './agent.js';
import { getAgentConfig, getAgentSystemPrompt, AgentConfig } from './agent-config.js';
import { buildMemoryContext } from './memory.js';
import { logToHiveMind, createInterAgentTask, updateInterAgentTask } from './db.js';
import { logger } from './logger.js';
import { readEnvFile } from './env.js';

const env = readEnvFile();
const DEFAULT_AGENT_ID = env['DEFAULT_AGENT_ID'] ?? 'main';

/**
 * Orchestrator for multi-agent coordination
 */
export class AgentOrchestrator {
  private activeAgents: Map<string, ReturnType<typeof createAgentRuntime>> = new Map();
  private messageHistory: Map<string, Array<{ role: 'user' | 'assistant'; content: string }>> = new Map();

  /**
   * Get or create agent runtime
   */
  private getAgentRuntime(agentId: string): ReturnType<typeof createAgentRuntime> | null {
    if (this.activeAgents.has(agentId)) {
      return this.activeAgents.get(agentId)!;
    }

    const config = getAgentConfig(agentId);
    if (!config) {
      logger.warn({ agentId }, 'Agent config not found');
      return null;
    }

    const systemPrompt = getAgentSystemPrompt(agentId) ?? `You are ${config.name}. ${config.description ?? ''}`;
    const runtime = createAgentRuntime(systemPrompt);
    this.activeAgents.set(agentId, runtime);
    
    return runtime;
  }

  /**
   * Get message history for a chat
   */
  private getMessageHistory(chatId: string): Array<{ role: 'user' | 'assistant'; content: string }> {
    if (!this.messageHistory.has(chatId)) {
      this.messageHistory.set(chatId, []);
    }
    return this.messageHistory.get(chatId)!;
  }

  /**
   * Add message to history
   */
  private addToHistory(chatId: string, role: 'user' | 'assistant', content: string): void {
    const history = this.getMessageHistory(chatId);
    history.push({ role, content });
    
    // Keep history manageable
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }
  }

  /**
   * Clear history for a chat
   */
  public clearHistory(chatId: string): void {
    this.messageHistory.delete(chatId);
  }

  /**
   * Run agent with memory context
   */
  public async runWithContext(
    chatId: string,
    userMessage: string,
    agentId: string = DEFAULT_AGENT_ID,
    includeMemory: boolean = true
  ): Promise<AgentResult> {
    const runtime = this.getAgentRuntime(agentId);
    if (!runtime) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Build memory context
    let context = '';
    if (includeMemory) {
      const memory = await buildMemoryContext(chatId, userMessage, agentId);
      context = memory.context;
    }

    // Get conversation history
    const history = this.getMessageHistory(chatId);
    
    // Build messages
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    
    if (context) {
      messages.push({
        role: 'user',
        content: `Context from memory:\n${context}\n\n---\n\nUser message: ${userMessage}`,
      });
    } else {
      messages.push({ role: 'user', content: userMessage });
    }

    // Add recent history (last 10 messages)
    const recentHistory = history.slice(-10);
    for (const msg of recentHistory) {
      messages.push(msg);
    }

    // Run agent
    const result = await runAgent(runtime, messages, undefined, { chatId });

    // Add to history
    this.addToHistory(chatId, 'user', userMessage);
    this.addToHistory(chatId, 'assistant', result.content);

    // Log to hive mind
    logToHiveMind(agentId, 'message', `Responded to chat ${chatId}`, {
      messageLength: userMessage.length,
      responseLength: result.content.length,
      toolCalls: result.toolCalls,
    });

    return result;
  }

  /**
   * Delegate to another agent
   */
  public async delegateToAgent(
    fromAgentId: string,
    toAgentId: string,
    prompt: string,
    chatId: string
  ): Promise<string> {
    const toRuntime = this.getAgentRuntime(toAgentId);
    if (!toRuntime) {
      throw new Error(`Target agent ${toAgentId} not found`);
    }

    // Create inter-agent task
    const taskId = createInterAgentTask({
      from_agent: fromAgentId,
      to_agent: toAgentId,
      prompt,
      result: null,
      status: 'pending',
      created_at: Date.now(),
    });

    logToHiveMind(fromAgentId, 'delegate', `Delegated to ${toAgentId}`, { taskId, chatId });

    try {
      const result = await runAgent(toRuntime, [{ role: 'user', content: prompt }], undefined, { chatId });
      
      updateInterAgentTask(taskId, {
        result: result.content,
        status: 'completed',
        completed_at: Date.now(),
      });

      logToHiveMind(toAgentId, 'delegate_complete', `Completed delegation from ${fromAgentId}`, {
        taskId,
        resultLength: result.content.length,
      });

      return result.content;
    } catch (error) {
      updateInterAgentTask(taskId, {
        status: 'failed',
        completed_at: Date.now(),
      });

      logToHiveMind(toAgentId, 'delegate_failed', `Failed delegation from ${fromAgentId}`, {
        taskId,
        error: String(error),
      });

      throw error;
    }
  }

  /**
   * Broadcast to multiple agents
   */
  public async broadcast(
    agentIds: string[],
    prompt: string,
    chatId: string
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>();

    await Promise.all(
      agentIds.map(async (agentId) => {
        try {
          const runtime = this.getAgentRuntime(agentId);
          if (!runtime) {
            results.set(agentId, `Agent ${agentId} not found`);
            return;
          }

          const result = await runAgent(runtime, [{ role: 'user', content: prompt }], undefined, { chatId });
          results.set(agentId, result.content);
          
          logToHiveMind(agentId, 'broadcast', `Responded to broadcast in ${chatId}`, {
            resultLength: result.content.length,
          });
        } catch (error) {
          results.set(agentId, `Error: ${error}`);
          logToHiveMind(agentId, 'broadcast_error', `Failed to respond to broadcast`, {
            error: String(error),
          });
        }
      })
    );

    return results;
  }

  /**
   * Get agent status
   */
  public getAgentStatus(agentId: string): {
    active: boolean;
    historyLength: number;
  } {
    return {
      active: this.activeAgents.has(agentId),
      historyLength: 0, // Would need to track per-agent
    };
  }

  /**
   * Shutdown agent
   */
  public shutdownAgent(agentId: string): void {
    this.activeAgents.delete(agentId);
    logger.info({ agentId }, 'Agent shutdown');
  }

  /**
   * Shutdown all agents
   */
  public shutdownAll(): void {
    this.activeAgents.clear();
    this.messageHistory.clear();
    logger.info('All agents shutdown');
  }
}

// Global orchestrator instance
export const orchestrator = new AgentOrchestrator();
