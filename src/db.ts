import Database, { Database as DatabaseType } from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { PROJECT_ROOT_DIR, STORE_DIR } from './config.js';
import { logger } from './logger.js';

// Ensure store directory exists
if (!existsSync(STORE_DIR)) {
  mkdirSync(STORE_DIR, { recursive: true });
}

const DB_PATH = join(STORE_DIR, 'claudeclaw.db');
export const db: DatabaseType = new Database(DB_PATH);

// Enable WAL mode
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

logger.info({ path: DB_PATH }, 'Database initialized');

// ============================================
// SCHEMA DEFINITIONS
// ============================================

export function initDatabase(): void {
  // Sessions table - composite key (chat_id, agent_id) for multi-agent
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      chat_id TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT 'main',
      session_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (chat_id, agent_id)
    )
  `);

  // Conversation log - always needed
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      agent_id TEXT DEFAULT 'main',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_log_chat_agent 
    ON conversation_log(chat_id, agent_id, created_at DESC)
  `);

  // Token usage tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      agent_id TEXT DEFAULT 'main',
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL,
      created_at INTEGER NOT NULL
    )
  `);
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_token_usage_chat_agent 
    ON token_usage(chat_id, agent_id, created_at DESC)
  `);

  // Memories table (Full v2)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      agent_id TEXT DEFAULT 'main',
      source TEXT,
      raw_text TEXT,
      summary TEXT,
      entities TEXT,
      topics TEXT,
      connections TEXT,
      importance REAL NOT NULL DEFAULT 0.5,
      salience INTEGER NOT NULL DEFAULT 0,
      consolidated INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      embedding BLOB,
      superseded_by INTEGER,
      created_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL
    )
  `);
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_chat 
    ON memories(chat_id, importance DESC, accessed_at DESC)
  `);

  // FTS5 virtual table for memories (content columns only)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      summary,
      raw_text,
      content=memories,
      content_rowid=id
    )
  `);

  // FTS triggers restricted to content columns
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, summary, raw_text) VALUES (new.id, new.summary, new.raw_text);
    END
  `);
  
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, summary, raw_text) VALUES ('delete', old.id, old.summary, old.raw_text);
    END
  `);
  
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF summary, raw_text ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, summary, raw_text) VALUES ('delete', old.id, old.summary, old.raw_text);
      INSERT INTO memories_fts(rowid, summary, raw_text) VALUES (new.id, new.summary, new.raw_text);
    END
  `);

  // Consolidations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS consolidations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      insight TEXT,
      connections TEXT,
      contradictions TEXT,
      source_memory_ids TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // Simple memory (turns table)
  db.exec(`
    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_turns_chat 
    ON turns(chat_id, created_at DESC)
  `);

  // Scheduled tasks
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule TEXT NOT NULL,
      next_run INTEGER NOT NULL,
      last_run INTEGER,
      last_result TEXT,
      priority INTEGER NOT NULL DEFAULT 3,
      agent_id TEXT NOT NULL DEFAULT 'main',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','running','completed','failed')),
      created_at INTEGER NOT NULL
    )
  `);
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status 
    ON scheduled_tasks(status, priority, next_run)
  `);

  // Mission tasks (multi-agent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS mission_tasks (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `);
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mission_tasks_status 
    ON mission_tasks(status, priority, created_at DESC)
  `);

  // Hive mind (cross-agent activity log)
  db.exec(`
    CREATE TABLE IF NOT EXISTS hive_mind (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_hive_mind_agent 
    ON hive_mind(agent_id, created_at DESC)
  `);

  // Inter-agent tasks
  db.exec(`
    CREATE TABLE IF NOT EXISTS inter_agent_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      prompt TEXT NOT NULL,
      result TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `);

  // WhatsApp tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
      content_encrypted TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      wa_message_id TEXT
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      content_encrypted TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
      created_at INTEGER NOT NULL,
      sent_at INTEGER
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_message_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_message_id TEXT NOT NULL,
      telegram_message_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // Slack messages
  db.exec(`
    CREATE TABLE IF NOT EXISTS slack_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT,
      content_encrypted TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'inbound',
      created_at INTEGER NOT NULL
    )
  `);

  // Audit log (security)
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      details TEXT,
      chat_id TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_type 
    ON audit_log(event_type, created_at DESC)
  `);

  // War Room transcripts
  db.exec(`
    CREATE TABLE IF NOT EXISTS warroom_transcript (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      speaker TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // Meeting sessions
  db.exec(`
    CREATE TABLE IF NOT EXISTS meet_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_url TEXT NOT NULL,
      meeting_title TEXT,
      briefing TEXT,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `);

  // Skill health tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_health (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('healthy','degraded','failed')),
      last_check INTEGER NOT NULL,
      error_message TEXT
    )
  `);

  // Skill usage statistics
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_name TEXT NOT NULL,
      chat_id TEXT,
      agent_id TEXT DEFAULT 'main',
      invoked_at INTEGER NOT NULL,
      duration_ms INTEGER,
      success INTEGER NOT NULL DEFAULT 1
    )
  `);

  // Skill approvals (for dangerous skills)
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_approvals (
      skill_name TEXT PRIMARY KEY,
      approved_by INTEGER NOT NULL,
      approved_at INTEGER NOT NULL
    )
  `);

  // Session summaries for long conversations
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      agent_id TEXT DEFAULT 'main',
      session_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // Compaction events
  db.exec(`
    CREATE TABLE IF NOT EXISTS compaction_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      agent_id TEXT DEFAULT 'main',
      session_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // Agent configs (for multi-agent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      model TEXT DEFAULT 'claude-sonnet-4-6',
      telegram_token TEXT,
      cwd TEXT NOT NULL,
      claude_md_path TEXT NOT NULL,
      mcp_allowlist TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  logger.info('Database schema initialized');
}

// ============================================
// SESSION OPERATIONS
// ============================================

export interface Session {
  chat_id: string;
  agent_id: string;
  session_id: string;
  updated_at: number;
}

export function getSession(chatId: string, agentId: string = 'main'): Session | undefined {
  const stmt = db.prepare('SELECT * FROM sessions WHERE chat_id = ? AND agent_id = ?');
  return stmt.get(chatId, agentId) as Session | undefined;
}

export function setSession(chatId: string, sessionId: string, agentId: string = 'main'): void {
  const stmt = db.prepare(`
    INSERT INTO sessions (chat_id, agent_id, session_id, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(chat_id, agent_id) DO UPDATE SET
      session_id = excluded.session_id,
      updated_at = excluded.updated_at
  `);
  stmt.run(chatId, agentId, sessionId, Date.now());
}

export function clearSession(chatId: string, agentId: string = 'main'): void {
  const stmt = db.prepare('DELETE FROM sessions WHERE chat_id = ? AND agent_id = ?');
  stmt.run(chatId, agentId);
}

// ============================================
// CONVERSATION LOG OPERATIONS
// ============================================

export interface ConversationEntry {
  id: number;
  chat_id: string;
  agent_id: string;
  role: string;
  content: string;
  created_at: number;
}

export function logConversation(
  chatId: string,
  role: 'user' | 'assistant',
  content: string,
  agentId: string = 'main'
): void {
  const stmt = db.prepare(`
    INSERT INTO conversation_log (chat_id, agent_id, role, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(chatId, agentId, role, content, Date.now());
}

export function getRecentConversation(
  chatId: string,
  limit: number = 20,
  agentId: string = 'main'
): ConversationEntry[] {
  const stmt = db.prepare(`
    SELECT * FROM conversation_log 
    WHERE chat_id = ? AND agent_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(chatId, agentId, limit) as ConversationEntry[];
}

// ============================================
// TOKEN USAGE OPERATIONS
// ============================================

export interface TokenUsageEntry {
  id: number;
  chat_id: string;
  agent_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  created_at: number;
}

export function logTokenUsage(
  chatId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  estimatedCost: number,
  agentId: string = 'main'
): void {
  const stmt = db.prepare(`
    INSERT INTO token_usage (chat_id, agent_id, model, input_tokens, output_tokens, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(chatId, agentId, model, inputTokens, outputTokens, estimatedCost, Date.now());
}

export function getTokenUsage(
  chatId?: string,
  agentId?: string,
  since?: number
): TokenUsageEntry[] {
  let query = 'SELECT * FROM token_usage WHERE 1=1';
  const params: (string | number)[] = [];
  
  if (chatId) {
    query += ' AND chat_id = ?';
    params.push(chatId);
  }
  if (agentId) {
    query += ' AND agent_id = ?';
    params.push(agentId);
  }
  if (since) {
    query += ' AND created_at >= ?';
    params.push(since);
  }
  
  query += ' ORDER BY created_at DESC';
  
  const stmt = db.prepare(query);
  return stmt.all(...params) as TokenUsageEntry[];
}

export function getTotalTokenUsage(chatId?: string, agentId?: string): { input: number; output: number; cost: number } {
  let query = 'SELECT SUM(input_tokens) as input, SUM(output_tokens) as output, SUM(estimated_cost) as cost FROM token_usage WHERE 1=1';
  const params: string[] = [];
  
  if (chatId) {
    query += ' AND chat_id = ?';
    params.push(chatId);
  }
  if (agentId) {
    query += ' AND agent_id = ?';
    params.push(agentId);
  }
  
  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { input: number | null; output: number | null; cost: number | null };
  
  return {
    input: result.input ?? 0,
    output: result.output ?? 0,
    cost: result.cost ?? 0,
  };
}

export function getTokenUsageStats() {
  const totals = getTotalTokenUsage();
  return {
    totalTokens: totals.input + totals.output,
    promptTokens: totals.input,
    completionTokens: totals.output,
    estimatedCost: totals.cost
  };
}

// ============================================
// MEMORY OPERATIONS (Full v2)
// ============================================

export interface Memory {
  id: number;
  chat_id: string;
  agent_id: string;
  source: string | null;
  raw_text: string | null;
  summary: string;
  entities: string | null;
  topics: string | null;
  connections: string | null;
  importance: number;
  salience: number;
  consolidated: number;
  pinned: number;
  embedding: Buffer | null;
  superseded_by: number | null;
  created_at: number;
  accessed_at: number;
}

export function saveMemory(memory: Omit<Memory, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO memories (
      chat_id, agent_id, source, raw_text, summary, entities, topics, connections,
      importance, salience, consolidated, pinned, embedding, superseded_by,
      created_at, accessed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    memory.chat_id,
    memory.agent_id,
    memory.source,
    memory.raw_text,
    memory.summary,
    memory.entities,
    memory.topics,
    memory.connections,
    memory.importance,
    memory.salience,
    memory.consolidated,
    memory.pinned,
    memory.embedding,
    memory.superseded_by,
    memory.created_at,
    memory.accessed_at
  );
  
  return result.lastInsertRowid as number;
}

export function getMemory(id: number): Memory | undefined {
  const stmt = db.prepare('SELECT * FROM memories WHERE id = ?');
  return stmt.get(id) as Memory | undefined;
}

export function getMemoriesByChat(
  chatId: string,
  limit: number = 50,
  agentId: string = 'main'
): Memory[] {
  const stmt = db.prepare(`
    SELECT * FROM memories 
    WHERE chat_id = ? AND agent_id = ? AND pinned = 0 AND superseded_by IS NULL
    ORDER BY importance DESC, accessed_at DESC
    LIMIT ?
  `);
  return stmt.all(chatId, agentId, limit) as Memory[];
}

export function getHighImportanceMemories(
  chatId: string,
  minImportance: number = 0.7,
  limit: number = 5,
  agentId: string = 'main'
): Memory[] {
  const stmt = db.prepare(`
    SELECT * FROM memories 
    WHERE chat_id = ? AND agent_id = ? AND importance >= ? AND pinned = 0 AND superseded_by IS NULL
    ORDER BY accessed_at DESC
    LIMIT ?
  `);
  return stmt.all(chatId, agentId, minImportance, limit) as Memory[];
}

export function getUnconsolidatedMemories(
  chatId: string,
  limit: number = 20,
  agentId: string = 'main'
): Memory[] {
  const stmt = db.prepare(`
    SELECT * FROM memories 
    WHERE chat_id = ? AND agent_id = ? AND consolidated = 0 AND pinned = 0
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(chatId, agentId, limit) as Memory[];
}

export function markMemoriesConsolidated(ids: number[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  const stmt = db.prepare(`UPDATE memories SET consolidated = 1 WHERE id IN (${placeholders})`);
  stmt.run(...ids);
}

export function updateMemoryAccessTime(id: number): void {
  const stmt = db.prepare('UPDATE memories SET accessed_at = ? WHERE id = ?');
  stmt.run(Date.now(), id);
}

export function pinMemory(id: number, pinned: boolean = true): void {
  const stmt = db.prepare('UPDATE memories SET pinned = ? WHERE id = ?');
  stmt.run(pinned ? 1 : 0, id);
}

export function supersedeMemory(oldId: number, newId: number): void {
  const stmt = db.prepare('UPDATE memories SET superseded_by = ? WHERE id = ?');
  stmt.run(newId, oldId);
}

export function deleteMemory(id: number): void {
  const stmt = db.prepare('DELETE FROM memories WHERE id = ?');
  stmt.run(id);
}

export function getMemoryStats(): {
  total: number;
  pinned: number;
  consolidated: number;
} {
  const total = getMemoryCount();
  const pinnedStmt = db.prepare('SELECT COUNT(*) as count FROM memories WHERE pinned = 1');
  const pinned = (pinnedStmt.get() as { count: number }).count;
  const consolidated = getConsolidationCount();
  
  return {
    total,
    pinned,
    consolidated
  };
}

export function getAllMemories(): Memory[] {
  const stmt = db.prepare('SELECT * FROM memories ORDER BY created_at DESC');
  return stmt.all() as Memory[];
}

export function searchMemories(query: string, chatId?: string, agentId: string = 'main'): Memory[] {
  if (chatId) {
    return searchMemoriesFts(chatId, query, 10, agentId);
  }

  const stmt = db.prepare(`
    SELECT * FROM memories
    WHERE summary LIKE ? OR raw_text LIKE ?
    ORDER BY importance DESC, accessed_at DESC
    LIMIT 50
  `);
  const pattern = `%${query}%`;
  return stmt.all(pattern, pattern) as Memory[];
}

export function searchMemoriesFts(
  chatId: string,
  query: string,
  limit: number = 10,
  agentId: string = 'main'
): Memory[] {
  const stmt = db.prepare(`
    SELECT m.* FROM memories m
    JOIN memories_fts fts ON m.id = fts.rowid
    WHERE memories_fts MATCH ? AND m.chat_id = ? AND m.agent_id = ?
    ORDER BY rank
    LIMIT ?
  `);
  return stmt.all(query, chatId, agentId, limit) as Memory[];
}

// ============================================
// CONSOLIDATION OPERATIONS
// ============================================

export interface Consolidation {
  id: number;
  chat_id: string;
  summary: string;
  insight: string | null;
  connections: string | null;
  contradictions: string | null;
  source_memory_ids: string;
  created_at: number;
}

export function saveConsolidation(consolidation: Omit<Consolidation, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO consolidations (chat_id, summary, insight, connections, contradictions, source_memory_ids, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    consolidation.chat_id,
    consolidation.summary,
    consolidation.insight,
    consolidation.connections,
    consolidation.contradictions,
    consolidation.source_memory_ids,
    consolidation.created_at
  );
  
  return result.lastInsertRowid as number;
}

export function getRecentConsolidations(
  chatId: string,
  limit: number = 3
): Consolidation[] {
  const stmt = db.prepare(`
    SELECT * FROM consolidations 
    WHERE chat_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(chatId, limit) as Consolidation[];
}

// ============================================
// SIMPLE MEMORY OPERATIONS
// ============================================

export interface Turn {
  id: number;
  chat_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

export function saveTurn(chatId: string, role: 'user' | 'assistant', content: string): void {
  const stmt = db.prepare(`
    INSERT INTO turns (chat_id, role, content, created_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(chatId, role, content, Date.now());
}

export function getRecentTurns(chatId: string, limit: number = 50): Turn[] {
  const stmt = db.prepare(`
    SELECT * FROM turns 
    WHERE chat_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(chatId, limit) as Turn[];
}

export function pruneOldTurns(chatId: string, keep: number = 50): void {
  // Keep only the most recent 'keep' turns
  const stmt = db.prepare(`
    DELETE FROM turns WHERE chat_id = ? AND id NOT IN (
      SELECT id FROM turns WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?
    )
  `);
  stmt.run(chatId, chatId, keep);
}

// ============================================
// SCHEDULED TASK OPERATIONS
// ============================================

export interface ScheduledTask {
  id: string;
  chat_id: string;
  prompt: string;
  schedule: string;
  next_run: number;
  last_run: number | null;
  last_result: string | null;
  priority: number;
  agent_id: string;
  status: 'active' | 'paused' | 'running' | 'completed' | 'failed';
  created_at: number;
}

export function createTask(task: Omit<ScheduledTask, 'created_at'>): void {
  const stmt = db.prepare(`
    INSERT INTO scheduled_tasks (
      id, chat_id, prompt, schedule, next_run, last_run, last_result,
      priority, agent_id, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    task.id,
    task.chat_id,
    task.prompt,
    task.schedule,
    task.next_run,
    task.last_run,
    task.last_result,
    task.priority,
    task.agent_id,
    task.status,
    Date.now()
  );
}

export function getTask(id: string): ScheduledTask | undefined {
  const stmt = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?');
  return stmt.get(id) as ScheduledTask | undefined;
}

export function getAllTasks(): ScheduledTask[] {
  const stmt = db.prepare('SELECT * FROM scheduled_tasks ORDER BY priority ASC, next_run ASC');
  return stmt.all() as ScheduledTask[];
}

export function getDueTasks(): ScheduledTask[] {
  const now = Date.now();
  const stmt = db.prepare(`
    SELECT * FROM scheduled_tasks 
    WHERE status = 'active' AND next_run <= ?
    ORDER BY priority ASC, next_run ASC
  `);
  return stmt.all(now) as ScheduledTask[];
}

export function updateTask(id: string, updates: Partial<ScheduledTask>): void {
  const fields = Object.keys(updates)
    .filter(k => k !== 'id' && k !== 'created_at')
    .map(k => `${k} = ?`)
    .join(', ');
  
  const values = Object.entries(updates)
    .filter(([k]) => k !== 'id' && k !== 'created_at')
    .map(([, v]) => v);
  
  if (fields) {
    const stmt = db.prepare(`UPDATE scheduled_tasks SET ${fields} WHERE id = ?`);
    stmt.run(...values, id);
  }
}

export function deleteTask(id: string): void {
  const stmt = db.prepare('DELETE FROM scheduled_tasks WHERE id = ?');
  stmt.run(id);
}

// ============================================
// MISSION TASK OPERATIONS
// ============================================

export interface MissionTask {
  id: string;
  chat_id: string;
  agent_id: string;
  prompt: string;
  priority: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result: string | null;
  created_at: number;
  completed_at: number | null;
}

export function createMissionTask(task: Omit<MissionTask, 'created_at' | 'completed_at'>): void {
  const stmt = db.prepare(`
    INSERT INTO mission_tasks (id, chat_id, agent_id, prompt, priority, status, result, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    task.id,
    task.chat_id,
    task.agent_id,
    task.prompt,
    task.priority,
    task.status,
    task.result,
    Date.now()
  );
}

export function getMissionTasks(status?: string, agentId?: string): MissionTask[] {
  let query = 'SELECT * FROM mission_tasks WHERE 1=1';
  const params: string[] = [];
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (agentId) {
    query += ' AND agent_id = ?';
    params.push(agentId);
  }
  
  query += ' ORDER BY priority ASC, created_at DESC';
  
  const stmt = db.prepare(query);
  return stmt.all(...params) as MissionTask[];
}

export function updateMissionTask(id: string, updates: Partial<MissionTask>): void {
  const fields = Object.keys(updates)
    .filter(k => k !== 'id' && k !== 'created_at')
    .map(k => `${k} = ?`)
    .join(', ');
  
  const values = Object.entries(updates)
    .filter(([k]) => k !== 'id' && k !== 'created_at')
    .map(([, v]) => v);
  
  if (fields) {
    const stmt = db.prepare(`UPDATE mission_tasks SET ${fields} WHERE id = ?`);
    stmt.run(...values, id);
  }
}

// ============================================
// HIVE MIND OPERATIONS
// ============================================

export interface HiveMindEntry {
  id: number;
  agent_id: string;
  action_type: string;
  summary: string;
  metadata: string | null;
  created_at: number;
}

export function logToHiveMind(
  agentId: string,
  actionType: string,
  summary: string,
  metadata?: Record<string, unknown>
): void {
  const stmt = db.prepare(`
    INSERT INTO hive_mind (agent_id, action_type, summary, metadata, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    agentId,
    actionType,
    summary,
    metadata ? JSON.stringify(metadata) : null,
    Date.now()
  );
}

export function getRecentHiveMind(limit: number = 50, agentId?: string): HiveMindEntry[] {
  let query = 'SELECT * FROM hive_mind';
  const params: Array<string | number> = [];
  
  if (agentId) {
    query += ' WHERE agent_id = ?';
    params.push(agentId);
  }
  
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  
  const stmt = db.prepare(query);
  return stmt.all(...params) as HiveMindEntry[];
}

// ============================================
// INTER-AGENT TASK OPERATIONS
// ============================================

export interface InterAgentTask {
  id: number;
  from_agent: string;
  to_agent: string;
  prompt: string;
  result: string | null;
  status: 'pending' | 'completed' | 'failed';
  created_at: number;
  completed_at: number | null;
}

export function createInterAgentTask(task: Omit<InterAgentTask, 'id' | 'completed_at'>): number {
  const stmt = db.prepare(`
    INSERT INTO inter_agent_tasks (from_agent, to_agent, prompt, result, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    task.from_agent,
    task.to_agent,
    task.prompt,
    task.result,
    task.status,
    Date.now()
  );
  
  return result.lastInsertRowid as number;
}

export function updateInterAgentTask(id: number, updates: Partial<InterAgentTask>): void {
  const fields = Object.keys(updates)
    .filter(k => k !== 'id' && k !== 'created_at')
    .map(k => `${k} = ?`)
    .join(', ');
  
  const values = Object.entries(updates)
    .filter(([k]) => k !== 'id' && k !== 'created_at')
    .map(([, v]) => v);
  
  if (fields) {
    const stmt = db.prepare(`UPDATE inter_agent_tasks SET ${fields} WHERE id = ?`);
    stmt.run(...values, id);
  }
}

// ============================================
// AUDIT LOG OPERATIONS
// ============================================

export interface AuditEvent {
  id: number;
  event_type: string;
  details: string | null;
  chat_id: string | null;
  created_at: number;
}

export function logAuditEvent(
  eventType: string,
  details?: string,
  chatId?: string
): void {
  const stmt = db.prepare(`
    INSERT INTO audit_log (event_type, details, chat_id, created_at)
    VALUES (?, ?, ?, ?)
  `);
  
  stmt.run(eventType, details ?? null, chatId ?? null, Date.now());
}

export function saveWAMessage(data: {
  message_id: string;
  chat_id: string;
  sender: string;
  message: string;
  timestamp: number;
  direction: 'incoming' | 'outgoing';
}): void {
  const stmt = db.prepare(`
    INSERT INTO wa_messages (chat_id, direction, content_encrypted, timestamp, wa_message_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(
    data.chat_id,
    data.direction === 'incoming' ? 'inbound' : 'outbound',
    data.message,
    data.timestamp,
  );
}

export function saveSlackMessage(data: {
  message_id: string;
  channel_id: string;
  user_id: string;
  user_name: string;
  message: string;
  timestamp: number;
  direction: 'incoming' | 'outgoing';
}): void {
  const stmt = db.prepare(`
    INSERT INTO slack_messages (channel_id, user_id, user_name, content_encrypted, timestamp, direction, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    data.channel_id,
    data.user_id,
    data.user_name,
    data.message,
    data.timestamp.toString(),
    data.direction === 'incoming' ? 'inbound' : 'outbound',
    Date.now()
  );
}

export function getAuditLog(
  eventType?: string,
  limit: number = 100
): AuditEvent[] {
  let query = 'SELECT * FROM audit_log';
  const params: (string | number)[] = [];
  
  if (eventType) {
    query += ' WHERE event_type = ?';
    params.push(eventType);
  }
  
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  
  const stmt = db.prepare(query);
  return stmt.all(...params) as AuditEvent[];
}

// ============================================
// WAR ROOM TRANSCRIPT OPERATIONS
// ============================================

export interface WarRoomTranscript {
  id: number;
  agent_id: string | null;
  speaker: string;
  content: string;
  created_at: number;
}

export function logWarRoomTranscript(
  speaker: string,
  content: string,
  agentId?: string
): void {
  const stmt = db.prepare(`
    INSERT INTO warroom_transcript (agent_id, speaker, content, created_at)
    VALUES (?, ?, ?, ?)
  `);
  
  stmt.run(agentId ?? null, speaker, content, Date.now());
}

export function getWarRoomTranscript(limit: number = 100): WarRoomTranscript[] {
  const stmt = db.prepare(`
    SELECT * FROM warroom_transcript 
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit) as WarRoomTranscript[];
}

// ============================================
// MEETING SESSION OPERATIONS
// ============================================

export interface MeetSession {
  id: number;
  meeting_url: string;
  meeting_title: string | null;
  briefing: string | null;
  summary: string | null;
  status: 'pending' | 'active' | 'completed' | 'failed';
  created_at: number;
  completed_at: number | null;
}

export function createMeetSession(session: Omit<MeetSession, 'id' | 'completed_at'>): number {
  const stmt = db.prepare(`
    INSERT INTO meet_sessions (meeting_url, meeting_title, briefing, summary, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    session.meeting_url,
    session.meeting_title,
    session.briefing,
    session.summary,
    session.status,
    Date.now()
  );
  
  return result.lastInsertRowid as number;
}

export function getMeetSession(id: number): MeetSession | undefined {
  const stmt = db.prepare('SELECT * FROM meet_sessions WHERE id = ?');
  return stmt.get(id) as MeetSession | undefined;
}

export function updateMeetSession(id: number, updates: Partial<MeetSession>): void {
  const fields = Object.keys(updates)
    .filter(k => k !== 'id' && k !== 'created_at')
    .map(k => `${k} = ?`)
    .join(', ');
  
  const values = Object.entries(updates)
    .filter(([k]) => k !== 'id' && k !== 'created_at')
    .map(([, v]) => v);
  
  if (fields) {
    const stmt = db.prepare(`UPDATE meet_sessions SET ${fields} WHERE id = ?`);
    stmt.run(...values, id);
  }
}

export function getMeetSessions(): MeetSession[] {
  const stmt = db.prepare('SELECT * FROM meet_sessions ORDER BY created_at DESC');
  return stmt.all() as MeetSession[];
}

export function saveMeetSession(session: Omit<MeetSession, 'id' | 'completed_at'>): number {
  return createMeetSession(session);
}

// ============================================
// SKILL HEALTH OPERATIONS
// ============================================

export interface SkillHealth {
  id: number;
  skill_name: string;
  status: 'healthy' | 'degraded' | 'failed';
  last_check: number;
  error_message: string | null;
}

export function updateSkillHealth(
  skillName: string,
  status: 'healthy' | 'degraded' | 'failed',
  errorMessage?: string
): void {
  const stmt = db.prepare(`
    INSERT INTO skill_health (skill_name, status, last_check, error_message)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(skill_name) DO UPDATE SET
      status = excluded.status,
      last_check = excluded.last_check,
      error_message = excluded.error_message
  `);
  
  stmt.run(skillName, status, Date.now(), errorMessage ?? null);
}

export function getSkillHealth(skillName: string): SkillHealth | undefined {
  const stmt = db.prepare('SELECT * FROM skill_health WHERE skill_name = ?');
  return stmt.get(skillName) as SkillHealth | undefined;
}

export function getAllSkillHealth(): SkillHealth[] {
  const stmt = db.prepare('SELECT * FROM skill_health ORDER BY skill_name');
  return stmt.all() as SkillHealth[];
}

// ============================================
// SKILL USAGE OPERATIONS
// ============================================

export interface SkillUsage {
  id: number;
  skill_name: string;
  chat_id: string | null;
  agent_id: string;
  invoked_at: number;
  duration_ms: number | null;
  success: number;
}

export function logSkillUsage(
  skillName: string,
  success: boolean,
  durationMs?: number,
  chatId?: string,
  agentId: string = 'main'
): void {
  const stmt = db.prepare(`
    INSERT INTO skill_usage (skill_name, chat_id, agent_id, invoked_at, duration_ms, success)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(skillName, chatId ?? null, agentId, Date.now(), durationMs ?? null, success ? 1 : 0);
}

export function getSkillUsageStats(since?: number): Array<{
  skill_name: string;
  invocations: number;
  success_rate: number;
  avg_duration_ms: number;
}> {
  let query = `
    SELECT 
      skill_name,
      COUNT(*) as invocations,
      AVG(success) as success_rate,
      AVG(duration_ms) as avg_duration_ms
    FROM skill_usage
  `;
  const params: number[] = [];
  
  if (since) {
    query += ' WHERE invoked_at >= ?';
    params.push(since);
  }
  
  query += ' GROUP BY skill_name';
  
  const stmt = db.prepare(query);
  return stmt.all(...params) as Array<{
    skill_name: string;
    invocations: number;
    success_rate: number;
    avg_duration_ms: number;
  }>;
}

// ============================================
// SKILL APPROVAL OPERATIONS
// ============================================

export interface SkillApproval {
  skill_name: string;
  approved_by: number;
  approved_at: number;
}

export function saveSkillApproval(skillName: string, userId: number): void {
  const stmt = db.prepare(`
    INSERT INTO skill_approvals (skill_name, approved_by, approved_at)
    VALUES (?, ?, ?)
    ON CONFLICT(skill_name) DO UPDATE SET
      approved_by = excluded.approved_by,
      approved_at = excluded.approved_at
  `);
  stmt.run(skillName, userId, Date.now());
}

export function getSkillApproval(skillName: string, userId: number): SkillApproval | undefined {
  const stmt = db.prepare(
    'SELECT * FROM skill_approvals WHERE skill_name = ? AND approved_by = ?'
  );
  return stmt.get(skillName, userId) as SkillApproval | undefined;
}

export function getAllSkillApprovals(): SkillApproval[] {
  const stmt = db.prepare('SELECT * FROM skill_approvals ORDER BY skill_name');
  return stmt.all() as SkillApproval[];
}

export function revokeSkillApproval(skillName: string): void {
  const stmt = db.prepare('DELETE FROM skill_approvals WHERE skill_name = ?');
  stmt.run(skillName);
}

// ============================================
// SESSION SUMMARY OPERATIONS
// ============================================

export interface SessionSummary {
  id: number;
  chat_id: string;
  agent_id: string;
  session_id: string;
  summary: string;
  created_at: number;
}

export function saveSessionSummary(
  chatId: string,
  sessionId: string,
  summary: string,
  agentId: string = 'main'
): void {
  const stmt = db.prepare(`
    INSERT INTO session_summaries (chat_id, agent_id, session_id, summary, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  stmt.run(chatId, agentId, sessionId, summary, Date.now());
}

export function getSessionSummary(
  chatId: string,
  sessionId: string,
  agentId: string = 'main'
): SessionSummary | undefined {
  const stmt = db.prepare(`
    SELECT * FROM session_summaries 
    WHERE chat_id = ? AND agent_id = ? AND session_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return stmt.get(chatId, agentId, sessionId) as SessionSummary | undefined;
}

export function getSessionSummaries(): SessionSummary[] {
  const stmt = db.prepare('SELECT * FROM session_summaries ORDER BY created_at DESC');
  return stmt.all() as SessionSummary[];
}

// ============================================
// COMPACTION EVENT OPERATIONS
// ============================================

export interface CompactionEvent {
  id: number;
  chat_id: string;
  agent_id: string;
  session_id: string;
  summary: string;
  created_at: number;
}

export function logCompactionEvent(
  chatId: string,
  sessionId: string,
  summary: string,
  agentId: string = 'main'
): void {
  const stmt = db.prepare(`
    INSERT INTO compaction_events (chat_id, agent_id, session_id, summary, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  stmt.run(chatId, agentId, sessionId, summary, Date.now());
}

// ============================================
// AGENT CONFIG OPERATIONS
// ============================================

export interface AgentConfigRecord {
  id: string;
  name: string;
  description: string | null;
  model: string;
  telegram_token: string | null;
  cwd: string;
  claude_md_path: string;
  mcp_allowlist: string | null;
  created_at: number;
  updated_at: number;
}

export function saveAgentConfig(
  config: Omit<AgentConfigRecord, 'created_at' | 'updated_at'> | AgentConfigRecord
): void {
  const stmt = db.prepare(`
    INSERT INTO agent_configs (
      id, name, description, model, telegram_token, cwd, claude_md_path, mcp_allowlist, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      model = excluded.model,
      telegram_token = excluded.telegram_token,
      cwd = excluded.cwd,
      claude_md_path = excluded.claude_md_path,
      mcp_allowlist = excluded.mcp_allowlist,
      updated_at = excluded.updated_at
  `);
  
  const now = Date.now();
  stmt.run(
    config.id,
    config.name,
    config.description,
    config.model,
    config.telegram_token,
    config.cwd,
    config.claude_md_path,
    config.mcp_allowlist,
    now,
    now
  );
}

export function getAgentConfigRecord(id: string): AgentConfigRecord | undefined {
  const stmt = db.prepare('SELECT * FROM agent_configs WHERE id = ?');
  return stmt.get(id) as AgentConfigRecord | undefined;
}

export function getAllAgentConfigs(): AgentConfigRecord[] {
  const stmt = db.prepare('SELECT * FROM agent_configs ORDER BY name');
  return stmt.all() as AgentConfigRecord[];
}

export function deleteAgentConfig(id: string): void {
  const stmt = db.prepare('DELETE FROM agent_configs WHERE id = ?');
  stmt.run(id);
}

// ============================================
// DECAY SWEEP OPERATIONS
// ============================================

export async function runDecaySweep(): Promise<number> {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const oneWeek = 7 * oneDay;
  const oneMonth = 30 * oneDay;
  
  // High importance (>= 0.8) memories decay very slowly
  // Medium importance (0.5-0.8) decay at normal rate
  // Low importance (< 0.5) decay faster
  
  let deleted = 0;
  
  // Delete low importance memories not accessed in 7 days
  const lowImportanceStmt = db.prepare(`
    DELETE FROM memories 
    WHERE importance < 0.5 
    AND pinned = 0 
    AND superseded_by IS NULL
    AND accessed_at < ?
  `);
  
  const lowImportanceResult = lowImportanceStmt.run(now - oneWeek);
  deleted += lowImportanceResult.changes;
  
  // Reduce medium importance memories that haven't been accessed in 14 days
  const mediumImportanceStmt = db.prepare(`
    UPDATE memories 
    SET importance = importance * 0.8
    WHERE importance >= 0.5 AND importance < 0.8
    AND pinned = 0 
    AND superseded_by IS NULL
    AND accessed_at < ?
  `);
  
  mediumImportanceStmt.run(now - oneWeek);
  
  // Delete memories with very low importance (< 0.1) that haven't been accessed in 30 days
  const veryLowStmt = db.prepare(`
    DELETE FROM memories 
    WHERE importance < 0.1 
    AND pinned = 0 
    AND superseded_by IS NULL
    AND accessed_at < ?
  `);
  
  const veryLowResult = veryLowStmt.run(now - oneMonth);
  deleted += veryLowResult.changes;
  
  logger.info({ deleted }, 'Decay sweep completed');
  return deleted;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

export function getMemoryCount(chatId?: string, agentId?: string): number {
  let query = 'SELECT COUNT(*) as count FROM memories WHERE pinned = 0 AND superseded_by IS NULL';
  const params: string[] = [];
  
  if (chatId) {
    query += ' AND chat_id = ?';
    params.push(chatId);
  }
  if (agentId) {
    query += ' AND agent_id = ?';
    params.push(agentId);
  }
  
  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { count: number };
  return result.count;
}

export function getConsolidationCount(chatId?: string): number {
  let query = 'SELECT COUNT(*) as count FROM consolidations';
  const params: string[] = [];
  
  if (chatId) {
    query += ' WHERE chat_id = ?';
    params.push(chatId);
  }
  
  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { count: number };
  return result.count;
}

// Initialize on import
initDatabase();
