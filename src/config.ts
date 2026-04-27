import { readEnvFile, PROJECT_ROOT } from './env.js';
import { join } from 'path';

const env = readEnvFile();

// Core
export const TELEGRAM_BOT_TOKEN = env['TELEGRAM_BOT_TOKEN'] ?? '';
export const ALLOWED_CHAT_ID = env['ALLOWED_CHAT_ID'] ?? '';

// Voice
export const GROQ_API_KEY = env['GROQ_API_KEY'] ?? '';
export const OPENAI_API_KEY = env['OPENAI_API_KEY'] ?? '';
export const ELEVENLABS_API_KEY = env['ELEVENLABS_API_KEY'] ?? '';
export const ELEVENLABS_VOICE_ID = env['ELEVENLABS_VOICE_ID'] ?? '';
export const KOKORO_URL = env['KOKORO_URL'] ?? '';

// Memory v2 + War Room + Video
export const GOOGLE_API_KEY = env['GOOGLE_API_KEY'] ?? '';

// War Room legacy mode
export const DEEPGRAM_API_KEY = env['DEEPGRAM_API_KEY'] ?? '';
export const CARTESIA_API_KEY = env['CARTESIA_API_KEY'] ?? '';
export const WARROOM_MODE = env['WARROOM_MODE'] ?? 'live';

// Security
export const PIN_HASH = env['PIN_HASH'] ?? '';
export const PIN_SALT = env['PIN_SALT'] ?? '';
export const IDLE_LOCK_MINUTES = parseInt(env['IDLE_LOCK_MINUTES'] ?? '30', 10);
export const KILL_PHRASE = env['KILL_PHRASE'] ?? '';

// Meeting bot
export const PIKA_API_KEY = env['PIKA_API_KEY'] ?? '';
export const RECALL_API_KEY = env['RECALL_API_KEY'] ?? '';

// Multi-agent
export const CLAUDECLAW_CONFIG = env['CLAUDECLAW_CONFIG'] ?? join(process.env.HOME ?? '', '.claudeclaw');
export const COMMS_TELEGRAM_TOKEN = env['COMMS_TELEGRAM_TOKEN'] ?? '';
export const CONTENT_TELEGRAM_TOKEN = env['CONTENT_TELEGRAM_TOKEN'] ?? '';
export const OPS_TELEGRAM_TOKEN = env['OPS_TELEGRAM_TOKEN'] ?? '';
export const RESEARCH_TELEGRAM_TOKEN = env['RESEARCH_TELEGRAM_TOKEN'] ?? '';

// Agent behavior
export const AGENT_TIMEOUT_MS = parseInt(env['AGENT_TIMEOUT_MS'] ?? '900000', 10);
export const AGENT_MAX_TURNS = parseInt(env['AGENT_MAX_TURNS'] ?? '30', 10);
export const SHOW_COST_FOOTER = env['SHOW_COST_FOOTER'] ?? 'compact';
export const STREAM_STRATEGY = env['STREAM_STRATEGY'] ?? 'off';
export const MEMORY_NUDGE_INTERVAL_TURNS = parseInt(env['MEMORY_NUDGE_INTERVAL_TURNS'] ?? '10', 10);
export const MEMORY_NUDGE_INTERVAL_HOURS = parseInt(env['MEMORY_NUDGE_INTERVAL_HOURS'] ?? '2', 10);

// Slack
export const SLACK_BOT_TOKEN = env['SLACK_BOT_TOKEN'] ?? '';

// System
export const LOG_LEVEL = env['LOG_LEVEL'] ?? 'info';
export const NODE_ENV = env['NODE_ENV'] ?? 'development';

// Derived
export const PROJECT_ROOT_DIR = PROJECT_ROOT;
export const STORE_DIR = join(PROJECT_ROOT, 'store');
export const MAX_MESSAGE_LENGTH = 4096; // Telegram limit
export const TYPING_REFRESH_MS = 4000;
export const CONSOLIDATION_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
export const DASHBOARD_PORT = 3141;
export const WARROOM_PORT = 7860;

// Agent overrides for runtime reconfiguration
interface AgentOverrides {
  model?: string;
  timeoutMs?: number;
  maxTurns?: number;
}

let agentOverrides: Map<string, AgentOverrides> = new Map();

export function setAgentOverrides(agentId: string, overrides: AgentOverrides): void {
  agentOverrides.set(agentId, overrides);
}

export function getAgentOverrides(agentId: string): AgentOverrides | undefined {
  return agentOverrides.get(agentId);
}

export function setGlobalAgentOverrides(overrides: AgentOverrides): void {
  agentOverrides.set('*', overrides);
}

export function getGlobalAgentOverrides(): AgentOverrides | undefined {
  return agentOverrides.get('*');
}