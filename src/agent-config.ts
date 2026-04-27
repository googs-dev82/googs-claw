import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { readEnvFile, PROJECT_ROOT as ENV_PROJECT_ROOT } from './env.js';
import { logger } from './logger.js';
import { 
  getAgentConfigRecord, 
  saveAgentConfig, 
  getAllAgentConfigs,
  deleteAgentConfig as dbDeleteAgentConfig,
  AgentConfigRecord 
} from './db.js';

const env = readEnvFile();
const PROJECT_ROOT = env['PROJECT_ROOT_DIR'] ?? ENV_PROJECT_ROOT;
const AGENTS_DIR = join(PROJECT_ROOT, 'agents');

export interface AgentConfig {
  id: string;
  name: string;
  description?: string;
  model: string;
  telegramToken?: string;
  cwd: string;
  claudeMdPath: string;
  mcpAllowlist?: string[];
  createdAt: number;
  updatedAt: number;
}

interface AggregateAgentYaml {
  agents?: Array<{
    id?: string;
    name?: string;
    description?: string;
    model?: string;
    telegram_token?: string;
    system_prompt?: string;
    tools?: string[];
  }>;
}

/**
 * Load agent configuration from agent.yaml
 */
export function loadAgentYaml(agentDir: string): Record<string, unknown> | null {
  const yamlPath = join(agentDir, 'agent.yaml');
  
  if (!existsSync(yamlPath)) {
    return null;
  }

  try {
    const content = readFileSync(yamlPath, 'utf-8');
    const parsed = yaml.load(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }

    // Simple YAML parser for basic key-value pairs
    const result: Record<string, unknown> = {};
    
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const key = trimmed.slice(0, colonIndex).trim();
        let value = trimmed.slice(colonIndex + 1).trim();
        
        // Remove quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        result[key] = value;
      }
    }
    
    return result;
  } catch (error) {
    logger.warn({ error, path: yamlPath }, 'Failed to load agent.yaml');
    return null;
  }
}

function loadAggregateAgentConfig(agentId: string): AgentConfig | null {
  const yamlPath = join(AGENTS_DIR, 'agent.yaml');
  if (!existsSync(yamlPath)) {
    return null;
  }

  try {
    const parsed = yaml.load(readFileSync(yamlPath, 'utf-8')) as AggregateAgentYaml | null;
    const agent = parsed?.agents?.find((entry) => entry.id === agentId);
    if (!agent) {
      return null;
    }

    return {
      id: agentId,
      name: agent.name ?? agentId,
      description: agent.description,
      model: agent.model ?? 'claude-sonnet-4-6',
      telegramToken: agent.telegram_token,
      cwd: PROJECT_ROOT,
      claudeMdPath: join(PROJECT_ROOT, 'CLAUDE.md'),
      mcpAllowlist: agent.tools,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  } catch (error) {
    logger.warn({ error, path: yamlPath }, 'Failed to load aggregate agents/agent.yaml');
    return null;
  }
}

function getAggregateAgentSystemPrompt(agentId: string): string | null {
  const yamlPath = join(AGENTS_DIR, 'agent.yaml');
  if (!existsSync(yamlPath)) {
    return null;
  }

  try {
    const parsed = yaml.load(readFileSync(yamlPath, 'utf-8')) as AggregateAgentYaml | null;
    return parsed?.agents?.find((entry) => entry.id === agentId)?.system_prompt ?? null;
  } catch (error) {
    logger.warn({ error, path: yamlPath }, 'Failed to load aggregate agent prompt');
    return null;
  }
}

/**
 * Resolve agent directory path
 */
export function resolveAgentDir(agentId: string): string {
  return join(AGENTS_DIR, agentId);
}

/**
 * Resolve CLAUDE.md path for an agent
 */
export function resolveAgentClaudeMd(agentDir: string): string | null {
  const claudeMdPath = join(agentDir, 'CLAUDE.md');
  return existsSync(claudeMdPath) ? claudeMdPath : null;
}

/**
 * Load agent configuration from file system
 */
export function loadAgentConfigFromFile(agentId: string): AgentConfig | null {
  const agentDir = resolveAgentDir(agentId);
  
  if (!existsSync(agentDir)) {
    return null;
  }

  const yaml = loadAgentYaml(agentDir);
  const claudeMdPath = resolveAgentClaudeMd(agentDir);

  if (!yaml && !claudeMdPath) {
    return null;
  }

  return {
    id: agentId,
    name: (yaml?.name as string) ?? agentId,
    description: yaml?.description as string | undefined,
    model: (yaml?.model as string) ?? 'claude-sonnet-4-6',
    telegramToken: yaml?.telegram_token as string | undefined,
    cwd: agentDir,
    claudeMdPath: claudeMdPath ?? join(agentDir, 'CLAUDE.md'),
    mcpAllowlist: yaml?.mcp_allowlist 
      ? (yaml.mcp_allowlist as string).split(',').map(s => s.trim())
      : undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Load all agent configurations
 */
export function loadAllAgentConfigs(): AgentConfig[] {
  const configs: AgentConfig[] = [];

  if (!existsSync(AGENTS_DIR)) {
    return configs;
  }

  const entries = readdirSync(AGENTS_DIR);
  
  for (const entry of entries) {
    const agentDir = join(AGENTS_DIR, entry);
    
    if (statSync(agentDir).isDirectory()) {
      const config = loadAgentConfigFromFile(entry);
      if (config) {
        configs.push(config);
      }
    }
  }

  return configs;
}

/**
 * Get agent configuration (from DB or file system)
 */
export function getAgentConfig(agentId: string): AgentConfig | null {
  // First try database
  const dbConfig = getAgentConfigRecord(agentId);
  
  if (dbConfig) {
    return {
      id: dbConfig.id,
      name: dbConfig.name,
      description: dbConfig.description ?? undefined,
      model: dbConfig.model,
      telegramToken: dbConfig.telegram_token ?? undefined,
      cwd: dbConfig.cwd,
      claudeMdPath: dbConfig.claude_md_path,
      mcpAllowlist: dbConfig.mcp_allowlist 
        ? dbConfig.mcp_allowlist.split(',').map(s => s.trim())
        : undefined,
      createdAt: dbConfig.created_at,
      updatedAt: dbConfig.updated_at,
    };
  }

  // Fall back to file system
  return loadAgentConfigFromFile(agentId) ?? loadAggregateAgentConfig(agentId);
}

/**
 * Save agent configuration to database
 */
export function saveAgentConfigToDb(config: AgentConfig): void {
  saveAgentConfig({
    id: config.id,
    name: config.name,
    description: config.description ?? null,
    model: config.model,
    telegram_token: config.telegramToken ?? null,
    cwd: config.cwd,
    claude_md_path: config.claudeMdPath,
    mcp_allowlist: config.mcpAllowlist?.join(',') ?? null,
    created_at: config.createdAt,
    updated_at: config.updatedAt,
  });
}

/**
 * Delete agent configuration
 */
export function deleteAgentConfig(agentId: string): void {
  dbDeleteAgentConfig(agentId);
}

/**
 * Get all available agents
 */
export function getAllAgents(): AgentConfig[] {
  // Combine DB and file system configs
  const dbConfigs = getAllAgentConfigs().map(c => ({
    id: c.id,
    name: c.name,
    description: c.description ?? undefined,
    model: c.model,
    telegramToken: c.telegram_token ?? undefined,
    cwd: c.cwd,
    claudeMdPath: c.claude_md_path,
    mcpAllowlist: c.mcp_allowlist 
      ? c.mcp_allowlist.split(',').map(s => s.trim())
      : undefined,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));

  const fileConfigs = [
    ...loadAllAgentConfigs(),
    ...(['main', 'comms', 'content', 'ops', 'research']
      .map((id) => loadAggregateAgentConfig(id))
      .filter((config): config is AgentConfig => config !== null)),
  ];
  
  // Merge, preferring DB configs
  const merged = new Map<string, AgentConfig>();
  
  for (const config of fileConfigs) {
    merged.set(config.id, config);
  }
  
  for (const config of dbConfigs) {
    merged.set(config.id, config);
  }

  return Array.from(merged.values());
}

/**
 * Get agent system prompt from CLAUDE.md
 */
export function getAgentSystemPrompt(agentId: string): string | null {
  const aggregatePrompt = getAggregateAgentSystemPrompt(agentId);
  if (aggregatePrompt) {
    return aggregatePrompt;
  }

  const config = getAgentConfig(agentId);
  
  if (!config || !config.claudeMdPath) {
    return null;
  }

  if (!existsSync(config.claudeMdPath)) {
    return null;
  }

  try {
    return readFileSync(config.claudeMdPath, 'utf-8');
  } catch (error) {
    logger.warn({ error, path: config.claudeMdPath }, 'Failed to read CLAUDE.md');
    return null;
  }
}

/**
 * Check if agent exists
 */
export function agentExists(agentId: string): boolean {
  return getAgentConfig(agentId) !== null;
}

/**
 * Get default agent (main)
 */
export function getDefaultAgent(): AgentConfig | null {
  return getAgentConfig('main');
}
