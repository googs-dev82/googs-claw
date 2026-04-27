import { EventEmitter } from 'events';

export type ChatEventType =
  | 'user_message'
  | 'assistant_message'
  | 'processing'
  | 'progress'
  | 'error'
  | 'hive_mind';

export interface ChatEvent {
  type: ChatEventType;
  chatId: string;
  agentId?: string;
  data: unknown;
  timestamp: number;
}

export const chatEvents = new EventEmitter();
export const voiceEnabledChats = new Set<string>();
export const activeSessions = new Map<string, { startedAt: number; agentId?: string }>();
export const abortControllers = new Map<string, AbortController>();
export const selectedChatAgents = new Map<string, string>();

// Security state
export let isSystemLocked = true;
export let lastActivityAt = Date.now();

export function touchActivity(): void {
  lastActivityAt = Date.now();
}

export function setLocked(locked: boolean): void {
  isSystemLocked = locked;
}

// Message queue state
export const messageQueues = new Map<string, {
  queue: Array<() => Promise<void>>;
  processing: boolean;
}>();

// War Room state
export let warRoomRunning = false;
export let warRoomPid: number | null = null;

// Dashboard SSE connections
export const sseConnections = new Set<{
  write: (data: string) => void;
  close: () => void;
}>();

export function broadcastSseEvent(event: ChatEvent): void {
  const data = JSON.stringify(event);
  for (const conn of sseConnections) {
    try {
      conn.write(`data: ${data}\n\n`);
    } catch {
      // Connection may be closed
    }
  }
}

// Agent status tracking
export interface AgentStatus {
  id: string;
  name: string;
  status: 'active' | 'idle' | 'error';
  lastActivity: number;
  currentSession?: string;
}

export const agentStatuses = new Map<string, AgentStatus>();

export function updateAgentStatus(agentId: string, status: Partial<AgentStatus>): void {
  const existing = agentStatuses.get(agentId);
  if (existing) {
    agentStatuses.set(agentId, { ...existing, ...status });
  } else {
    agentStatuses.set(agentId, {
      id: agentId,
      name: agentId,
      status: 'idle',
      lastActivity: Date.now(),
      ...status,
    });
  }
}

export function getSelectedAgent(chatId: string): string | undefined {
  return selectedChatAgents.get(chatId);
}

export function setSelectedAgent(chatId: string, agentId: string): void {
  selectedChatAgents.set(chatId, agentId);
}

export function clearSelectedAgent(chatId: string): void {
  selectedChatAgents.delete(chatId);
}

// Scheduler state
export let schedulerRunning = false;

// WhatsApp state
export let whatsappConnected = false;
export let whatsappClient: unknown = null;
