import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from './logger.js';
import { readEnvFile } from './env.js';
import { getAllMemories, getMemoryStats, searchMemories, deleteMemory, getSessionSummaries, getTokenUsageStats } from './db.js';
import { getSchedulerStatus, getScheduledTasks } from './scheduler.js';
import { getWhatsAppStatus } from './whatsapp.js';
import { getSlackStatus } from './slack.js';
import { getVoiceHealthStatus } from './voice.js';
import { getSecurityStats } from './security.js';

const env = readEnvFile();

const app = new Hono();

/**
 * Get dashboard HTML
 */
function getDashboardHTML(stats: any): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClaudeClaw Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      min-height: 100vh;
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 1px solid #30363d;
    }
    h1 { color: #58a6ff; font-size: 28px; }
    .status-badge {
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 500;
    }
    .status-ok { background: #238636; color: #fff; }
    .status-warn { background: #9e6a03; color: #fff; }
    .status-error { background: #da3633; color: #fff; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 20px;
    }
    .card h2 {
      color: #8b949e;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 15px;
    }
    .stat {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #30363d;
    }
    .stat:last-child { border-bottom: none; }
    .stat-label { color: #8b949e; }
    .stat-value { color: #58a6ff; font-weight: 600; }
    .progress-bar {
      height: 8px;
      background: #30363d;
      border-radius: 4px;
      margin-top: 10px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #58a6ff, #238636);
      border-radius: 4px;
      transition: width 0.3s ease;
    }
    .memory-list {
      max-height: 300px;
      overflow-y: auto;
    }
    .memory-item {
      padding: 12px;
      background: #0d1117;
      border-radius: 6px;
      margin-bottom: 8px;
      font-size: 14px;
      line-height: 1.5;
    }
    .memory-item .meta {
      color: #8b949e;
      font-size: 12px;
      margin-top: 8px;
    }
    .search-box {
      width: 100%;
      padding: 12px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #c9d1d9;
      font-size: 14px;
      margin-bottom: 15px;
    }
    .search-box:focus {
      outline: none;
      border-color: #58a6ff;
    }
    .btn {
      padding: 8px 16px;
      background: #238636;
      color: #fff;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
    }
    .btn:hover { background: #2ea043; }
    .btn-danger { background: #da3633; }
    .btn-danger:hover { background: #f85149; }
    .tabs {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
    }
    .tab {
      padding: 10px 20px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #8b949e;
      cursor: pointer;
    }
    .tab.active {
      background: #58a6ff;
      color: #fff;
      border-color: #58a6ff;
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .service-status {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px;
      background: #0d1117;
      border-radius: 6px;
      margin-bottom: 10px;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    .dot.green { background: #238636; }
    .dot.red { background: #da3633; }
    .dot.yellow { background: #9e6a03; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .loading { animation: pulse 1.5s infinite; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🤖 ClaudeClaw Dashboard</h1>
      <span class="status-badge status-ok">System Online</span>
    </header>

    <div class="grid">
      <div class="card">
        <h2>📊 System Status</h2>
        <div class="stat"><span class="stat-label">Uptime</span><span class="stat-value" id="uptime">Loading...</span></div>
        <div class="stat"><span class="stat-label">Memory Usage</span><span class="stat-value" id="memory">Loading...</span></div>
        <div class="stat"><span class="stat-label">CPU Load</span><span class="stat-value" id="cpu">Loading...</span></div>
      </div>

      <div class="card">
        <h2>💬 Platform Status</h2>
        <div class="service-status">
          <span class="dot green"></span>
          <span>Telegram</span>
          <span class="stat-value">Active</span>
        </div>
        <div class="service-status">
          <span class="dot ${stats.whatsapp?.ready ? 'green' : 'yellow'}"></span>
          <span>WhatsApp</span>
          <span class="stat-value">${stats.whatsapp?.ready ? 'Active' : 'Disconnected'}</span>
        </div>
        <div class="service-status">
          <span class="dot ${stats.slack?.ready ? 'green' : 'yellow'}"></span>
          <span>Slack</span>
          <span class="stat-value">${stats.slack?.ready ? 'Active' : 'Disconnected'}</span>
        </div>
        <div class="service-status">
          <span class="dot ${stats.voice?.healthy ? 'green' : 'red'}"></span>
          <span>Voice</span>
          <span class="stat-value">${stats.voice?.healthy ? 'Healthy' : 'Error'}</span>
        </div>
      </div>

      <div class="card">
        <h2>🧠 Memory System</h2>
        <div class="stat"><span class="stat-label">Total Memories</span><span class="stat-value">${stats.memory?.total || 0}</span></div>
        <div class="stat"><span class="stat-label">Short-term</span><span class="stat-value">${stats.memory?.shortTerm || 0}</span></div>
        <div class="stat"><span class="stat-label">Long-term</span><span class="stat-value">${stats.memory?.longTerm || 0}</span></div>
        <div class="stat"><span class="stat-label">Consolidations</span><span class="stat-value">${stats.memory?.consolidations || 0}</span></div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${Math.min((stats.memory?.total || 0) / 1000 * 100, 100)}%"></div>
        </div>
      </div>

      <div class="card">
        <h2>🔐 Security</h2>
        <div class="stat"><span class="stat-label">Authorized Users</span><span class="stat-value">${stats.security?.authorizedUsers || 0}</span></div>
        <div class="stat"><span class="stat-label">Blocked Users</span><span class="stat-value">${stats.security?.blockedUsers || 0}</span></div>
        <div class="stat"><span class="stat-label">Rate Limited</span><span class="stat-value">${stats.security?.rateLimited || 0}</span></div>
        <div class="stat"><span class="stat-label">Suspicious Blocked</span><span class="stat-value">${stats.security?.suspiciousBlocked || 0}</span></div>
      </div>

      <div class="card">
        <h2>📅 Scheduler</h2>
        <div class="stat"><span class="stat-label">Status</span><span class="stat-value">${stats.scheduler?.running ? 'Running' : 'Stopped'}</span></div>
        <div class="stat"><span class="stat-label">Total Tasks</span><span class="stat-value">${stats.scheduler?.totalTasks || 0}</span></div>
        <div class="stat"><span class="stat-label">Due Tasks</span><span class="stat-value">${stats.scheduler?.dueTasks || 0}</span></div>
      </div>

      <div class="card">
        <h2>💰 Token Usage (Today)</h2>
        <div class="stat"><span class="stat-label">Input Tokens</span><span class="stat-value">${stats.tokens?.input || 0}</span></div>
        <div class="stat"><span class="stat-label">Output Tokens</span><span class="stat-value">${stats.tokens?.output || 0}</span></div>
        <div class="stat"><span class="stat-label">Total Cost</span><span class="stat-value">$${((stats.tokens?.totalCost || 0) / 100).toFixed(2)}</span></div>
      </div>
    </div>

    <div class="card">
      <h2>🔍 Memory Search</h2>
      <input type="text" class="search-box" id="searchInput" placeholder="Search memories...">
      <div class="memory-list" id="memoryResults">
        ${stats.recentMemories?.map((m: any) => {
          const content = String(m.content ?? m.summary ?? m.raw_text ?? '');
          const type = String(m.memory_type ?? m.source ?? 'memory');
          const importance = typeof m.importance === 'number' ? m.importance.toFixed(2) : 'n/a';
          return `
          <div class="memory-item">
            ${content.slice(0, 200)}${content.length > 200 ? '...' : ''}
            <div class="meta">Type: ${type} | Importance: ${importance} | ${new Date(m.created_at).toLocaleDateString()}</div>
          </div>
        `;
        }).join('') || '<p style="color: #8b949e;">No memories yet</p>'}
      </div>
    </div>
  </div>

  <script>
    let startTime = Date.now();
    
    function updateStats() {
      fetch('/api/stats')
        .then(r => r.json())
        .then(data => {
          document.getElementById('uptime').textContent = data.uptime;
          document.getElementById('memory').textContent = data.memory;
          document.getElementById('cpu').textContent = data.cpu;
        })
        .catch(console.error);
    }

    document.getElementById('searchInput')?.addEventListener('input', (e) => {
      const query = e.target.value;
      if (query.length < 3) return;
      
      fetch('/api/memories/search?q=' + encodeURIComponent(query))
        .then(r => r.json())
        .then(memories => {
          const container = document.getElementById('memoryResults');
          if (memories.length === 0) {
            container.innerHTML = '<p style="color: #8b949e;">No results found</p>';
          } else {
            container.innerHTML = memories.map(m => {
              const content = String(m.content || m.summary || m.raw_text || '');
              const type = m.memory_type || m.source || 'memory';
              const importance = typeof m.importance === 'number' ? m.importance.toFixed(2) : 'n/a';
              return \`
              <div class="memory-item">
                \${content.slice(0, 200)}\${content.length > 200 ? '...' : ''}
                <div class="meta">Type: \${type} | Importance: \${importance}</div>
              </div>
            \`;
            }).join('');
          }
        });
    });

    setInterval(updateStats, 5000);
    updateStats();
  </script>
</body>
</html>`;
}

/**
 * Get all dashboard stats
 */
export function getDashboardStats() {
  const memoryStats = getMemoryStats();
  const securityStats = getSecurityStats();
  const schedulerStatus = getSchedulerStatus();
  const whatsappStatus = getWhatsAppStatus();
  const slackStatus = getSlackStatus();
  const tokenStats = getTokenUsageStats();
  const orchestratorStatus = { active: true };

  // Get recent memories
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

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() });
});

// Dashboard HTML
app.get('/', (c) => {
  const stats = getDashboardStats();
  return c.html(getDashboardHTML(stats));
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
app.get('/api/memories', (c) => {
  const memories = getAllMemories();
  return c.json(memories);
});

// API: Search memories
app.get('/api/memories/search', (c) => {
  const query = c.req.query('q');
  if (!query) {
    return c.json([]);
  }
  
  const results = searchMemories(query);
  return c.json(results);
});

// API: Delete memory
app.delete('/api/memories/:id', async (c) => {
  const id = c.req.param('id');
  deleteMemory(Number(id));
  return c.json({ success: true });
});

// API: Scheduler tasks
app.get('/api/scheduler/tasks', (c) => {
  const tasks = getScheduledTasks();
  return c.json(tasks);
});

// API: Token usage
app.get('/api/tokens', (c) => {
  const stats = getTokenUsageStats();
  return c.json(stats);
});

// API: Session summaries
app.get('/api/sessions', (c) => {
  const summaries = getSessionSummaries();
  return c.json(summaries);
});

// API: Security stats
app.get('/api/security', (c) => {
  const stats = getSecurityStats();
  return c.json(stats);
});

/**
 * Format uptime
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Format bytes
 */
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

/**
 * Start dashboard server
 */
export function startDashboard(): void {
  const port = parseInt(env['DASHBOARD_PORT'] || '3141', 10);
  const server = serve({
    fetch: app.fetch,
    port,
  });

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

/**
 * Stop dashboard server
 */
export function stopDashboard(): void {
  // hono/node-server doesn't have a clean stop method
  // In production, you'd use a more robust server setup
  logger.info('Dashboard server stopped');
}
