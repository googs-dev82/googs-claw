export interface DashboardData {
  memory: any;
  security: any;
  scheduler: any;
  whatsapp: any;
  slack: any;
  voice: any;
  tokens: any;
  orchestrator: any;
  recentMemories: any[];
}

export function renderDashboard(data: DashboardData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClaudeClaw OS Mission Control</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-base: #000000;
      --bg-panel: #0d1117;
      --bg-card: #161b22;
      --border: #30363d;
      --text-main: #c9d1d9;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --success: #238636;
      --danger: #da3633;
      --warning: #d29922;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
    
    body {
      background: var(--bg-base);
      color: var(--text-main);
      display: flex;
      height: 100vh;
      overflow: hidden;
    }

    /* Privacy Blur */
    body.privacy-blur .sensitive-text {
      filter: blur(5px);
      transition: filter 0.3s;
    }
    body.privacy-blur .sensitive-text:hover {
      filter: blur(0px);
    }

    /* Sidebar Navigation */
    nav {
      width: 250px;
      background: var(--bg-panel);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      padding: 20px 0;
    }

    .brand {
      padding: 0 20px 20px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .brand h1 { font-size: 18px; font-weight: 600; color: #fff; letter-spacing: 0.5px; }
    
    .nav-item {
      padding: 12px 20px;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 500;
      transition: all 0.2s;
      border-left: 3px solid transparent;
    }

    .nav-item:hover, .nav-item.active {
      background: rgba(88, 166, 255, 0.1);
      color: var(--accent);
      border-left-color: var(--accent);
    }

    /* Main Content Area */
    main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--bg-base);
    }

    .topbar {
      height: 60px;
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
    }

    .status-badge {
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      background: rgba(35, 134, 54, 0.1);
      color: var(--success);
      border: 1px solid rgba(35, 134, 54, 0.4);
    }

    /* Views */
    .view {
      flex: 1;
      overflow-y: auto;
      padding: 30px;
      display: none;
    }
    
    .view.active { display: block; }

    /* Dashboard Grid */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      display: flex;
      flex-direction: column;
    }

    .card h2 {
      color: var(--text-muted);
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
    }
    
    .stat-row:last-child { border-bottom: none; }
    .stat-label { color: var(--text-muted); font-size: 14px; }
    .stat-value { color: #fff; font-weight: 600; font-size: 14px; }

    /* Forms & Controls */
    input, select, textarea {
      width: 100%;
      padding: 10px 12px;
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-main);
      font-family: inherit;
      margin-bottom: 15px;
    }

    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.1);
    }

    .btn {
      padding: 8px 16px;
      background: var(--bg-panel);
      color: var(--text-main);
      border: 1px solid var(--border);
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s;
    }
    .btn:hover { background: #30363d; }
    .btn-primary { background: var(--success); border-color: var(--success); color: #fff; }
    .btn-primary:hover { background: #2ea043; border-color: #2ea043; }
    .btn-danger { background: var(--danger); border-color: var(--danger); color: #fff; }
    .btn-danger:hover { background: #f85149; border-color: #f85149; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 12px; color: var(--text-muted); font-size: 12px; text-transform: uppercase; border-bottom: 1px solid var(--border); }
    td { padding: 12px; font-size: 14px; border-bottom: 1px solid var(--border); color: var(--text-main); }
    tr:last-child td { border-bottom: none; }
    
    /* Memory specific */
    .memory-item {
      padding: 15px;
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      margin-bottom: 10px;
    }
    .memory-meta { display: flex; gap: 15px; margin-top: 10px; font-size: 12px; color: var(--text-muted); }

    /* Feed specific */
    .feed-item {
      padding: 12px 15px;
      border-left: 2px solid var(--border);
      margin-bottom: 10px;
      background: rgba(22, 27, 34, 0.5);
    }
    .feed-item.type-delegate { border-left-color: var(--accent); }
    .feed-item.type-action { border-left-color: var(--warning); }
    .feed-item.type-error { border-left-color: var(--danger); }
    
    /* Utilities */
    .flex { display: flex; gap: 10px; }
    .flex-between { display: flex; justify-content: space-between; align-items: center; }
    .mt-4 { margin-top: 20px; }
    .badge { padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .badge-blue { background: rgba(88, 166, 255, 0.1); color: var(--accent); border: 1px solid rgba(88, 166, 255, 0.2); }
    .badge-green { background: rgba(35, 134, 54, 0.1); color: var(--success); border: 1px solid rgba(35, 134, 54, 0.2); }
    .badge-yellow { background: rgba(210, 153, 34, 0.1); color: var(--warning); border: 1px solid rgba(210, 153, 34, 0.2); }
    
    .toggle-container { display: flex; align-items: center; gap: 10px; cursor: pointer; }
    .toggle { width: 40px; height: 20px; background: var(--border); border-radius: 10px; position: relative; transition: background 0.3s; }
    .toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: left 0.3s; }
    .toggle.active { background: var(--success); }
    .toggle.active::after { left: 22px; }

  </style>
</head>
<body>

  <!-- Sidebar -->
  <nav>
    <div class="brand">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #58a6ff;"><path d="M12 2a10 10 0 1 0 10 10H12V2Z"/><path d="M12 12 2.1 7.1"/><path d="M12 12l9.9 4.9"/></svg>
      <h1>ClaudeClaw OS</h1>
    </div>
    <div class="nav-item active" data-target="view-overview">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
      Overview
    </div>
    <div class="nav-item" data-target="view-memory">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
      Memory Timeline
    </div>
    <div class="nav-item" data-target="view-mission">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
      Mission Control
    </div>
    <div class="nav-item" data-target="view-hive">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
      Hive Mind
    </div>
    <div class="nav-item" data-target="view-agents">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
      Agents Directory
    </div>
    <div class="nav-item" data-target="view-warroom">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
      War Room
    </div>
  </nav>

  <!-- Main Content -->
  <main>
    <div class="topbar">
      <div class="status-badge" id="conn-status">● Connected</div>
      <div class="toggle-container" onclick="togglePrivacy()">
        <span style="font-size: 13px; color: var(--text-muted)">Privacy Blur</span>
        <div class="toggle" id="privacyToggle"></div>
      </div>
    </div>

    <!-- Overview View -->
    <div class="view active" id="view-overview">
      <div class="grid">
        <div class="card">
          <h2>📊 System Core</h2>
          <div class="stat-row"><span class="stat-label">Uptime</span><span class="stat-value" id="stat-uptime">...</span></div>
          <div class="stat-row"><span class="stat-label">Memory</span><span class="stat-value" id="stat-memory">...</span></div>
          <div class="stat-row"><span class="stat-label">CPU Load</span><span class="stat-value" id="stat-cpu">...</span></div>
        </div>
        
        <div class="card">
          <h2>🧠 Memory Stats</h2>
          <div class="stat-row"><span class="stat-label">Total Memories</span><span class="stat-value">${data.memory?.total || 0}</span></div>
          <div class="stat-row"><span class="stat-label">Consolidations</span><span class="stat-value">${data.memory?.consolidations || 0}</span></div>
          <div class="stat-row"><span class="stat-label">Vector Index Size</span><span class="stat-value">${data.memory?.longTerm || 0}</span></div>
        </div>

        <div class="card">
          <h2>💬 Integrations</h2>
          <div class="stat-row"><span class="stat-label">Telegram</span><span class="stat-value badge badge-green">Active</span></div>
          <div class="stat-row"><span class="stat-label">WhatsApp</span><span class="stat-value badge ${data.whatsapp?.ready ? 'badge-green' : 'badge-yellow'}">${data.whatsapp?.ready ? 'Active' : 'Offline'}</span></div>
          <div class="stat-row"><span class="stat-label">Voice (STT/TTS)</span><span class="stat-value badge ${data.voice?.healthy ? 'badge-green' : 'badge-danger'}">${data.voice?.healthy ? 'Healthy' : 'Degraded'}</span></div>
        </div>
      </div>

      <div class="card" style="min-height: 350px;">
        <h2>📈 Token Usage (Last 7 Days)</h2>
        <canvas id="tokenChart"></canvas>
      </div>
    </div>

    <!-- Memory View -->
    <div class="view" id="view-memory">
      <div class="card">
        <div class="flex-between" style="margin-bottom: 20px;">
          <h2>🔍 Memory Index</h2>
          <div class="flex">
            <input type="text" id="memorySearch" placeholder="Search vector space..." style="margin:0; width: 300px;">
          </div>
        </div>
        <div id="memoryList" style="max-height: calc(100vh - 250px); overflow-y: auto;">
          <!-- Memories populated by JS -->
        </div>
      </div>
    </div>

    <!-- Mission Control View -->
    <div class="view" id="view-mission">
      <div class="grid">
        <div class="card" style="grid-column: span 2;">
          <div class="flex-between mb-4">
            <h2>📅 Scheduled Tasks</h2>
            <button class="btn btn-primary" onclick="document.getElementById('newTaskForm').style.display='block'">+ New Task</button>
          </div>
          
          <div id="newTaskForm" style="display: none; background: var(--bg-panel); padding: 15px; border-radius: 6px; margin-bottom: 20px; border: 1px solid var(--border);">
            <div class="flex">
              <input type="text" id="taskPrompt" placeholder="Task Prompt (e.g. Generate daily report)">
              <input type="text" id="taskCron" placeholder="Cron (e.g. 0 9 * * *)" style="width: 150px;">
              <input type="text" id="taskAgent" placeholder="Agent ID" value="main" style="width: 120px;">
            </div>
            <div class="flex">
              <input type="text" id="taskChat" placeholder="Target Chat ID" style="width: 200px;">
              <button class="btn btn-primary" onclick="createTask()">Schedule</button>
              <button class="btn" onclick="document.getElementById('newTaskForm').style.display='none'">Cancel</button>
            </div>
          </div>

          <table id="tasksTable">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Prompt</th>
                <th>Schedule</th>
                <th>Next Run</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <!-- Tasks populated by JS -->
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Hive Mind View -->
    <div class="view" id="view-hive">
      <div class="card" style="height: calc(100vh - 120px); display: flex; flex-direction: column;">
        <div class="flex-between">
          <h2>🐝 Hive Mind Feed</h2>
          <span class="badge badge-blue">Live Updates</span>
        </div>
        <div id="hiveFeed" style="flex: 1; overflow-y: auto; margin-top: 15px; display: flex; flex-direction: column-reverse;">
          <!-- Feed items populated by JS -->
        </div>
      </div>
    </div>

    <!-- Agents View -->
    <div class="view" id="view-agents">
      <div class="flex-between" style="margin-bottom: 20px;">
        <h2>🤖 Agents Directory</h2>
        <button class="btn btn-primary" onclick="scaffoldAgent()">+ Scaffold Agent</button>
      </div>
      <div class="grid" id="agentsGrid">
        <!-- Agents populated by JS -->
      </div>
    </div>

    <!-- War Room View -->
    <div class="view" id="view-warroom">
      <div class="card" style="text-align: center; padding: 50px 20px;">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.5" style="margin-bottom: 20px;">
          <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
          <polyline points="2 17 12 22 22 17"></polyline>
          <polyline points="2 12 12 17 22 12"></polyline>
        </svg>
        <h2 style="font-size: 24px; color: #fff; margin-bottom: 10px; justify-content: center;">War Room Control</h2>
        <p style="color: var(--text-muted); margin-bottom: 30px; max-width: 500px; margin-left: auto; margin-right: auto;">
          The War Room is a real-time voice environment powered by Pipecat. Launch the WebRTC server to allow agents to converse interactively.
        </p>
        
        <div class="stat-row" style="max-width: 300px; margin: 0 auto 30px; background: var(--bg-panel); padding: 15px; border-radius: 6px;">
          <span class="stat-label">Server Status</span>
          <span class="stat-value badge" id="wrStatusBadge">Checking...</span>
        </div>

        <div class="flex" style="justify-content: center;">
          <button class="btn btn-primary" id="btnWrStart" onclick="startWarRoom()">Start Server</button>
          <button class="btn btn-danger" id="btnWrStop" onclick="stopWarRoom()" style="display:none;">Stop Server</button>
          <a href="/warroom" target="_blank" class="btn">Open Client UI ↗</a>
        </div>
      </div>
    </div>

  </main>

  <script>
    // Navigation
    document.querySelectorAll('.nav-item').forEach(nav => {
      nav.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        nav.classList.add('active');
        document.getElementById(nav.dataset.target).classList.add('active');
      });
    });

    // Privacy Toggle
    function togglePrivacy() {
      const toggle = document.getElementById('privacyToggle');
      const body = document.body;
      toggle.classList.toggle('active');
      body.classList.toggle('privacy-blur');
    }

    // Chart.js Setup
    let tokenChart;
    function initChart() {
      const ctx = document.getElementById('tokenChart').getContext('2d');
      Chart.defaults.color = '#8b949e';
      Chart.defaults.font.family = 'Inter';
      
      tokenChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
          datasets: [
            { label: 'Input Tokens', data: [0,0,0,0,0,0,0], backgroundColor: '#58a6ff' },
            { label: 'Output Tokens', data: [0,0,0,0,0,0,0], backgroundColor: '#238636' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { grid: { color: '#30363d' }, stacked: true },
            x: { grid: { display: false }, stacked: true }
          },
          plugins: { legend: { position: 'top' } }
        }
      });
    }

    // Polling & Data Fetching
    let isUpdating = false;
    async function updateStats() {
      if (isUpdating) return;
      isUpdating = true;
      try {
        const [statsRes, tasksRes, agentsRes, hiveRes, tokensRes] = await Promise.all([
          fetch('/api/stats'),
          fetch('/api/tasks'),
          fetch('/api/agents'),
          fetch('/api/hive-feed'),
          fetch('/api/token-usage')
        ]);

        const stats = await statsRes.json();
        document.getElementById('stat-uptime').textContent = stats.uptime;
        document.getElementById('stat-memory').textContent = stats.memory;
        document.getElementById('stat-cpu').textContent = stats.cpu;

        if (tasksRes.ok) {
          const tasks = await tasksRes.json();
          renderTasks(tasks);
        }

        if (agentsRes.ok) {
          const agents = await agentsRes.json();
          renderAgents(agents);
        }

        if (hiveRes.ok) {
          const feed = await hiveRes.json();
          renderHiveFeed(feed);
        }

        if (tokensRes.ok && tokenChart) {
          const tokenData = await tokensRes.json();
          // Update chart if data structure exists, otherwise placeholder
          if (tokenData.history) {
             tokenChart.data.labels = tokenData.history.map(d => d.date);
             tokenChart.data.datasets[0].data = tokenData.history.map(d => d.input);
             tokenChart.data.datasets[1].data = tokenData.history.map(d => d.output);
             tokenChart.update();
          }
        }
        
      } catch (e) {
        console.error('Fetch error', e);
        document.getElementById('conn-status').textContent = '● Disconnected';
        document.getElementById('conn-status').style.color = 'var(--danger)';
      } finally {
        isUpdating = false;
      }
    }

    function renderTasks(tasks) {
      const tbody = document.querySelector('#tasksTable tbody');
      if (!tasks.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-muted)">No scheduled tasks</td></tr>';
        return;
      }
      tbody.innerHTML = tasks.map(t => \`
        <tr>
          <td><span class="badge badge-blue">\${t.agent_id || 'main'}</span></td>
          <td class="sensitive-text">\${t.prompt.substring(0,40)}...</td>
          <td><code>\${t.schedule}</code></td>
          <td>\${new Date(t.next_run).toLocaleString()}</td>
          <td><span class="badge \${t.status === 'active' ? 'badge-green' : 'badge-yellow'}">\${t.status}</span></td>
          <td>
            <button class="btn btn-danger" style="padding:4px 8px; font-size:11px" onclick="deleteTask('\${t.id}')">Del</button>
          </td>
        </tr>
      \`).join('');
    }

    function renderAgents(agents) {
      const grid = document.getElementById('agentsGrid');
      grid.innerHTML = agents.map(a => \`
        <div class="card">
          <div class="flex-between" style="margin-bottom: 10px;">
            <h3 style="color:#fff; font-size: 16px;">\${a.name}</h3>
            <span class="badge badge-green">Online</span>
          </div>
          <p style="color:var(--text-muted); font-size:13px; margin-bottom:15px; line-height:1.4">\${a.description || ''}</p>
          <div class="stat-row">
            <span class="stat-label">ID</span>
            <span class="stat-value">\${a.id}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Model</span>
            <span class="stat-value">\${a.model || 'Default'}</span>
          </div>
        </div>
      \`).join('');
    }

    function renderHiveFeed(feed) {
      const container = document.getElementById('hiveFeed');
      container.innerHTML = feed.map(f => {
        let typeClass = 'type-action';
        if (f.action_type.includes('delegate')) typeClass = 'type-delegate';
        if (f.action_type.includes('error')) typeClass = 'type-error';
        
        return \`
        <div class="feed-item \${typeClass}">
          <div class="flex-between" style="margin-bottom: 5px;">
            <span class="badge badge-blue">\${f.agent_id}</span>
            <span style="font-size:11px; color:var(--text-muted)">\${new Date(f.created_at).toLocaleTimeString()}</span>
          </div>
          <div style="font-size:13px; color:#fff" class="sensitive-text">\${f.summary}</div>
        </div>
        \`;
      }).join('');
    }

    async function createTask() {
      const prompt = document.getElementById('taskPrompt').value;
      const schedule = document.getElementById('taskCron').value;
      const agentId = document.getElementById('taskAgent').value;
      const chatId = document.getElementById('taskChat').value;
      
      if(!prompt || !schedule || !chatId) return alert("Fill required fields");
      
      await fetch('/api/tasks', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ prompt, schedule, agent_id: agentId, chat_id: chatId })
      });
      
      document.getElementById('newTaskForm').style.display = 'none';
      updateStats();
    }

    async function deleteTask(id) {
      if(!confirm("Delete task?")) return;
      await fetch('/api/tasks/' + id, { method: 'DELETE' });
      updateStats();
    }

    // War Room Handlers
    async function checkWarRoom() {
      try {
        const res = await fetch('/api/warroom/status');
        const data = await res.json();
        const badge = document.getElementById('wrStatusBadge');
        const btnStart = document.getElementById('btnWrStart');
        const btnStop = document.getElementById('btnWrStop');
        
        if (data.running) {
          badge.className = 'stat-value badge badge-green';
          badge.textContent = 'Running (PID ' + data.pid + ')';
          btnStart.style.display = 'none';
          btnStop.style.display = 'block';
        } else {
          badge.className = 'stat-value badge badge-yellow';
          badge.textContent = 'Stopped';
          btnStart.style.display = 'block';
          btnStop.style.display = 'none';
        }
      } catch(e) {}
    }

    async function startWarRoom() {
      document.getElementById('wrStatusBadge').textContent = 'Starting...';
      await fetch('/api/warroom/start', { method: 'POST' });
      setTimeout(checkWarRoom, 2000);
    }

    async function stopWarRoom() {
      await fetch('/api/warroom/stop', { method: 'POST' });
      setTimeout(checkWarRoom, 1000);
    }

    // Init
    initChart();
    setInterval(updateStats, 30000);
    setInterval(checkWarRoom, 30000);
    updateStats();
    checkWarRoom();
    searchMemories();

    // SSE Setup
    const evtSource = new EventSource("/api/events");
    evtSource.addEventListener('connected', () => {
      document.getElementById('conn-status').textContent = '● Connected';
      document.getElementById('conn-status').style.color = 'var(--success)';
    });
    evtSource.addEventListener('ping', () => {
      document.getElementById('conn-status').textContent = '● Connected';
      document.getElementById('conn-status').style.color = 'var(--success)';
    });
    ['memory.deleted', 'memory.created', 'memory.consolidated', 'task.created', 'task.deleted', 'agent.scaffolded'].forEach(type => {
      evtSource.addEventListener(type, () => {
        updateStats();
        searchMemories();
      });
    });
    ['warroom.started', 'warroom.stopped'].forEach(type => {
      evtSource.addEventListener(type, () => {
        checkWarRoom();
      });
    });
    evtSource.onerror = function() {
      document.getElementById('conn-status').textContent = '● Reconnecting';
      document.getElementById('conn-status').style.color = 'var(--warning)';
    };
    evtSource.onmessage = function(event) {
      if (!event.data || event.data === 'ping') return;
      updateStats();
    };

    // Memory Logic
    async function searchMemories() {
      const q = document.getElementById('memorySearch').value;
      const url = q ? '/api/memories/search?q=' + encodeURIComponent(q) : '/api/memories';
      const res = await fetch(url);
      if (res.ok) {
        const memories = await res.json();
        renderMemories(memories);
      }
    }

    function renderMemories(memories) {
      const container = document.getElementById('memoryList');
      if (!memories.length) {
        container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted)">No memories found.</div>';
        return;
      }
      container.innerHTML = memories.map(m => {
        const content = String(m.content || m.summary || m.raw_text || '');
        const kind = String(m.type || m.memory_type || m.source || 'core');
        const importance = typeof m.importance === 'number' ? m.importance.toFixed(2) : 'n/a';
        return \`
        <div class="memory-item">
          <div class="flex-between">
            <span class="badge badge-blue">\${kind}</span>
            <button class="btn btn-danger" style="padding:2px 6px; font-size:10px" onclick="deleteMemory(\${m.id})">Del</button>
          </div>
          <div style="margin-top:10px; font-size:14px; color:#fff" class="sensitive-text">\${content || '(empty memory)'}</div>
          <div class="memory-meta">
            <span>Importance: \${importance}</span>
            <span>Created: \${new Date(m.created_at).toLocaleString()}</span>
          </div>
        </div>
      \`;
      }).join('');
    }

    async function deleteMemory(id) {
      if (!confirm('Delete this memory?')) return;
      await fetch('/api/memories/' + id, { method: 'DELETE' });
      searchMemories();
    }

    document.getElementById('memorySearch').addEventListener('input', (e) => {
      clearTimeout(window.searchTimeout);
      window.searchTimeout = setTimeout(searchMemories, 300);
    });

    async function scaffoldAgent() {
      const name = prompt("Agent Name (e.g. SalesBot):");
      if (!name) return;
      const token = prompt("Telegram Token:");
      if (!token) return;
      const description = prompt("Agent Description (optional):") || '';
      const model = prompt("Model (default: claude-sonnet-4-6):") || 'claude-sonnet-4-6';
      
      const res = await fetch('/api/agents/scaffold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, token, description, model })
      });
      
      if (res.ok) {
        const data = await res.json();
        alert("Agent scaffolded successfully: " + data.agent.id);
        updateStats();
      } else {
        const error = await res.json().catch(() => ({ error: 'Unknown error' }));
        alert("Error scaffolding agent: " + (error.error || 'Unknown error'));
      }
    }
  </script>
</body>
</html>`;
}
