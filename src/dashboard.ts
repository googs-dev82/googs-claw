import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { randomUUID } from 'crypto';
import { logger } from './logger.js';
import { PROJECT_ROOT, readEnvFile } from './env.js';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { getAllMemories, getMemoryStats, searchMemories, deleteMemory, getSessionSummaries, getTokenUsageStats, getRecentHiveMind } from './db.js';
import { getSchedulerStatus, getScheduledTasks, createScheduledTask, removeScheduledTask } from './scheduler.js';
import { getWhatsAppStatus } from './whatsapp.js';
import { getSlackStatus } from './slack.js';
import { getVoiceHealthStatus } from './voice.js';
import { getSecurityStats } from './security.js';
import { renderDashboard, DashboardData } from './dashboard-html.js';
import { getAllAgents, saveAgentConfigToDb, validateAgentId } from './agent-config.js';
import { getWarRoomHTML } from './warroom-html.js';

const env = readEnvFile();
export const app = new Hono();
const textEncoder = new TextEncoder();
const DASHBOARD_AUTH_TOKEN = env['DASHBOARD_AUTH_TOKEN'] || '';

type DashboardEvent = {
  type: string;
  payload?: unknown;
  timestamp: number;
};

const eventClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

export function publishDashboardEvent(type: string, payload?: unknown): void {
  const event: DashboardEvent = { type, payload, timestamp: Date.now() };
  const message = `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;

  for (const client of [...eventClients]) {
    try {
      client.enqueue(textEncoder.encode(message));
    } catch (error) {
      eventClients.delete(client);
      logger.warn({ error, type }, 'Removed closed dashboard SSE client');
    }
  }
}

export function getDashboardStats(): DashboardData {
  const memoryStats = getMemoryStats();
  const securityStats = getSecurityStats();
  const schedulerStatus = getSchedulerStatus();
  const whatsappStatus = getWhatsAppStatus();
  const slackStatus = getSlackStatus();
  const tokenStats = getTokenUsageStats();
  const orchestratorStatus = { active: true };

  const recentMemories = getAllMemories()
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 10);

  return {
    memory: memoryStats,
    security: securityStats,
    scheduler: schedulerStatus,
    whatsapp: whatsappStatus,
    slack: slackStatus,
    voice: { healthy: false, status: 'not checked' },
    tokens: tokenStats,
    orchestrator: orchestratorStatus,
    recentMemories,
  };
}

// Middleware
app.use('*', cors());

function isDashboardAuthorized(request: Request): boolean {
  if (!DASHBOARD_AUTH_TOKEN) {
    return true;
  }

  const url = new URL(request.url);
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return bearer === DASHBOARD_AUTH_TOKEN
    || request.headers.get('x-dashboard-token') === DASHBOARD_AUTH_TOKEN
    || url.searchParams.get('token') === DASHBOARD_AUTH_TOKEN;
}

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/events') {
    return next();
  }

  if (!isDashboardAuthorized(c.req.raw)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return next();
});

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() });
});

// Dashboard HTML
app.get('/', (c) => {
  const stats = getDashboardStats();
  return c.html(renderDashboard(stats));
});

// War Room HTML
app.get('/warroom', (c) => {
  return c.html(getWarRoomHTML());
});

// API: Stats
app.get('/api/stats', (c) => {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  return c.json({
    uptime: formatUptime(process.uptime()),
    memory: formatBytes(memUsage.heapUsed) + ' / ' + formatBytes(memUsage.heapTotal),
    cpu: ((cpuUsage.user + cpuUsage.system) / 1000000).toFixed(2) + 's',
  });
});

// API: Memories
app.get('/api/memories', (c) => c.json(getAllMemories()));
app.get('/api/memories/search', (c) => {
  const query = c.req.query('q');
  return c.json(query ? searchMemories(query) : []);
});
app.delete('/api/memories/:id', async (c) => {
  const id = Number(c.req.param('id'));
  deleteMemory(id);
  publishDashboardEvent('memory.deleted', { id });
  return c.json({ success: true });
});

// API: Scheduler tasks
app.get('/api/tasks', (c) => c.json(getScheduledTasks()));
app.post('/api/tasks', async (c) => {
  const body = await c.req.json();
  const { prompt, schedule, agent_id, chat_id } = body;
  try {
    const id = randomUUID();
    const task = createScheduledTask(id, chat_id, prompt, schedule, agent_id || 'main');
    publishDashboardEvent('task.created', { id, agent_id: task.agent_id, chat_id: task.chat_id });
    return c.json(task);
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});
app.delete('/api/tasks/:id', (c) => {
  const id = c.req.param('id');
  removeScheduledTask(id);
  publishDashboardEvent('task.deleted', { id });
  return c.json({ success: true });
});

// API: Agents
app.get('/api/agents', (c) => c.json(getAllAgents()));
app.post('/api/agents/scaffold', async (c) => {
  const body = await c.req.json();
  const { name, token, description, model } = body;
  
  if (!name || !token) return c.json({ success: false, error: 'Missing name or token' }, 400);

  const safeName = String(name).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!validateAgentId(safeName)) {
    return c.json({ success: false, error: 'Agent id must start with a lowercase letter and contain only lowercase letters, numbers, underscores, or hyphens.' }, 400);
  }

  const agents = getAllAgents();
  if (!agents.some((agent) => agent.id === safeName) && agents.length >= 20) {
    return c.json({ success: false, error: 'Agent limit reached (20).' }, 400);
  }

  const agentsDir = path.join(PROJECT_ROOT, 'agents');
  const agentDir = path.join(agentsDir, safeName);
  const agentYamlPath = path.join(agentDir, 'agent.yaml');
  const claudeMdPath = path.join(agentDir, 'CLAUDE.md');

  const now = Date.now();
  const selectedModel = String(model || 'claude-sonnet-4-6');
  const agentConfig = {
    id: safeName,
    name: String(name),
    description: description ? String(description) : `Dashboard-created agent for ${name}.`,
    model: selectedModel,
    telegramToken: String(token),
    cwd: agentDir,
    claudeMdPath,
    mcpAllowlist: ['Bash', 'Read', 'Edit', 'Grep', 'Glob', 'LS'],
    createdAt: now,
    updatedAt: now,
  };

  try {
    if (!existsSync(agentsDir)) {
      mkdirSync(agentsDir, { recursive: true });
    }
    if (!existsSync(agentDir)) {
      mkdirSync(agentDir, { recursive: true });
    }
    const yaml = [
      `id: ${agentConfig.id}`,
      `name: ${JSON.stringify(agentConfig.name)}`,
      `description: ${JSON.stringify(agentConfig.description)}`,
      `model: ${agentConfig.model}`,
      `telegram_token: ${JSON.stringify(agentConfig.telegramToken)}`,
      `mcp_allowlist: ${agentConfig.mcpAllowlist.join(',')}`,
      '',
    ].join('\n');
    const claudeMd = [
      `# Agent: ${agentConfig.name}`,
      '',
      `You are ${agentConfig.name}, a specialized ClaudeClaw agent.`,
      '',
      '## Role',
      agentConfig.description,
      '',
      '## Operating Guidelines',
      '- Stay within your role and explain assumptions when context is missing.',
      '- Log important work to the shared hive mind through the orchestrator.',
      '- Keep responses concise, useful, and safe for phone-first interaction.',
      '',
    ].join('\n');

    writeFileSync(agentYamlPath, yaml);
    writeFileSync(claudeMdPath, claudeMd);
    saveAgentConfigToDb(agentConfig);
    publishDashboardEvent('agent.scaffolded', { id: agentConfig.id, name: agentConfig.name });
    return c.json({ success: true, agent: agentConfig, configPath: agentYamlPath });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// API: Hive Mind
app.get('/api/hive-mind', (c) => {
  const limit = parseInt(c.req.query('limit') || '50', 10);
  return c.json(getRecentHiveMind(limit));
});

// API: Token usage
app.get('/api/tokens', (c) => c.json(getTokenUsageStats()));
app.get('/api/sessions', (c) => c.json(getSessionSummaries()));
app.get('/api/security', (c) => c.json(getSecurityStats()));

// API: Events (SSE)
app.get('/api/events', (c) => {
  if (!isDashboardAuthorized(c.req.raw)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  
  return new Response(new ReadableStream({
    start(controller) {
      eventClients.add(controller);
      controller.enqueue(textEncoder.encode(`event: connected\ndata: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`));
      const interval = setInterval(() => {
        controller.enqueue(textEncoder.encode(`event: ping\ndata: ${JSON.stringify({ type: 'ping', timestamp: Date.now() })}\n\n`));
      }, 5000);
      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(interval);
        eventClients.delete(controller);
      });
    }
  }));
});

// War Room process
let warRoomProcess: ChildProcess | null = null;

app.get('/api/warroom/status', (c) => c.json({ running: warRoomProcess !== null, pid: warRoomProcess?.pid || null }));

app.post('/api/warroom/start', (c) => { 
  if (!warRoomProcess) {
    warRoomProcess = spawn('python3', [path.resolve(PROJECT_ROOT, 'warroom/warroom_pipecat.py')]);
    warRoomProcess.stdout?.on('data', (data) => logger.info(`WarRoom: ${data}`));
    warRoomProcess.stderr?.on('data', (data) => logger.error(`WarRoom: ${data}`));
    warRoomProcess.on('exit', () => {
      warRoomProcess = null;
      publishDashboardEvent('warroom.stopped');
    });
    publishDashboardEvent('warroom.started', { pid: warRoomProcess.pid });
  }
  return c.json({ success: true, pid: warRoomProcess.pid }); 
});

app.post('/api/warroom/stop', (c) => { 
  if (warRoomProcess) {
    warRoomProcess.kill();
    warRoomProcess = null;
    publishDashboardEvent('warroom.stopped');
  }
  return c.json({ success: true }); 
});

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return size.toFixed(1) + ' ' + units[unitIndex];
}

export function startDashboard(): void {
  const port = parseInt(env['DASHBOARD_PORT'] || '3141', 10);
  const server = serve({ fetch: app.fetch, port });

  server.on('error', (error: unknown) => {
    const message = String(error);
    if (message.includes('EADDRINUSE')) {
      logger.warn({ port, error }, 'Dashboard port already in use');
      console.log(`\n📊 Dashboard already running at http://localhost:${port}\n`);
      return;
    }
    logger.error({ port, error }, 'Dashboard server error');
  });

  logger.info({ port }, 'Dashboard server started');
  console.log(`\n📊 Dashboard running at http://localhost:${port}\n`);
}

export function stopDashboard(): void {
  logger.info('Dashboard server stopped');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startDashboard();
}
