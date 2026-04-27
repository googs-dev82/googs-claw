/**
 * War Room HTML Frontend
 * Real-time voice interface for ClaudeClaw
 */

export function getWarRoomHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClaudeClaw War Room</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
      color: #c9d1d9;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 0;
      border-bottom: 1px solid #30363d;
      margin-bottom: 20px;
    }
    h1 {
      color: #58a6ff;
      font-size: 24px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
    }
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #da3633;
    }
    .status-dot.connected { background: #238636; }
    .status-dot.connecting { background: #9e6a03; animation: pulse 1s infinite; }
    
    .main-content {
      display: grid;
      grid-template-columns: 1fr 350px;
      gap: 20px;
      flex: 1;
    }
    
    .voice-panel {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 30px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 400px;
    }
    
    .avatar {
      width: 150px;
      height: 150px;
      border-radius: 50%;
      background: linear-gradient(135deg, #238636 0%, #58a6ff 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 60px;
      margin-bottom: 30px;
      position: relative;
      transition: transform 0.3s ease;
    }
    .avatar.listening {
      animation: pulse 1.5s infinite;
      box-shadow: 0 0 30px rgba(88, 166, 255, 0.5);
    }
    .avatar.speaking {
      animation: speak 0.5s infinite;
    }
    
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.05); }
    }
    @keyframes speak {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.02); }
    }
    
    .controls {
      display: flex;
      gap: 15px;
      margin-bottom: 20px;
    }
    
    .btn {
      padding: 15px 30px;
      border: none;
      border-radius: 30px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn-primary {
      background: #238636;
      color: #fff;
    }
    .btn-primary:hover { background: #2ea043; }
    .btn-primary:disabled { background: #30363d; cursor: not-allowed; }
    .btn-danger {
      background: #da3633;
      color: #fff;
    }
    .btn-danger:hover { background: #f85149; }
    .btn-secondary {
      background: #30363d;
      color: #c9d1d9;
    }
    .btn-secondary:hover { background: #484f58; }
    
    .transcript {
      width: 100%;
      max-width: 500px;
      text-align: center;
      min-height: 60px;
      padding: 15px;
      background: #0d1117;
      border-radius: 8px;
      font-size: 16px;
      line-height: 1.5;
    }
    .transcript .label {
      font-size: 12px;
      color: #8b949e;
      text-transform: uppercase;
      margin-bottom: 5px;
    }
    .transcript .text {
      color: #58a6ff;
    }
    .transcript.claude .text {
      color: #c9d1d9;
    }
    
    .sidebar {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 20px;
    }
    .card h2 {
      font-size: 14px;
      color: #8b949e;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 15px;
    }
    
    .conversation {
      max-height: 300px;
      overflow-y: auto;
    }
    .message {
      padding: 12px;
      margin-bottom: 10px;
      border-radius: 8px;
      font-size: 14px;
      line-height: 1.5;
    }
    .message.user {
      background: #0d1117;
      border-left: 3px solid #58a6ff;
    }
    .message.claude {
      background: #0d1117;
      border-left: 3px solid #238636;
    }
    .message .time {
      font-size: 11px;
      color: #8b949e;
      margin-top: 5px;
    }
    
    .settings-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .setting {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px;
      background: #0d1117;
      border-radius: 6px;
    }
    .setting label { font-size: 14px; }
    .setting input[type="checkbox"] {
      width: 20px;
      height: 20px;
      accent-color: #238636;
    }
    .setting select {
      padding: 5px 10px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 4px;
      color: #c9d1d9;
    }
    
    .audio-visualizer {
      width: 100%;
      height: 60px;
      background: #0d1117;
      border-radius: 8px;
      margin-top: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 3px;
    }
    .bar {
      width: 4px;
      background: #238636;
      border-radius: 2px;
      transition: height 0.1s ease;
    }
    
    @media (max-width: 900px) {
      .main-content {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🎙️ War Room</h1>
      <div class="status">
        <span class="status-dot" id="statusDot"></span>
        <span id="statusText">Connecting...</span>
      </div>
    </header>

    <div class="main-content">
      <div class="voice-panel">
        <div class="avatar" id="avatar">🤖</div>
        
        <div class="controls">
          <button class="btn btn-primary" id="startBtn">
            <span>🎤</span> Start Listening
          </button>
          <button class="btn btn-danger" id="stopBtn" disabled>
            <span>⏹️</span> Stop
          </button>
        </div>
        
        <div class="transcript" id="transcript">
          <div class="label">Ready</div>
          <div class="text">Click "Start Listening" to begin</div>
        </div>
        
        <div class="audio-visualizer" id="visualizer">
          ${Array(30).fill('<div class="bar" style="height: 10px;"></div>').join('')}
        </div>
      </div>

      <div class="sidebar">
        <div class="card">
          <h2>💬 Conversation</h2>
          <div class="conversation" id="conversation">
            <div class="message claude">
              <div>Hello! I'm ready to talk. Click "Start Listening" and speak naturally.</div>
              <div class="time">${new Date().toLocaleTimeString()}</div>
            </div>
          </div>
        </div>

        <div class="card">
          <h2>⚙️ Settings</h2>
          <div class="settings-list">
            <div class="setting">
              <label>Voice Output</label>
              <input type="checkbox" id="voiceOutput" checked>
            </div>
            <div class="setting">
              <label>Language</label>
              <select id="language">
                <option value="en" selected>English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
              </select>
            </div>
            <div class="setting">
              <label>Wake Word</label>
              <select id="wakeWord">
                <option value="none" selected>None</option>
                <option value="hey">Hey Claude</option>
                <option value="computer">Computer</option>
              </select>
            </div>
          </div>
        </div>

        <div class="card">
          <h2>📊 Session Stats</h2>
          <div id="stats">
            <div class="setting">
              <span>Messages</span>
              <span id="msgCount">0</span>
            </div>
            <div class="setting">
              <span>Duration</span>
              <span id="duration">0:00</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = wsProtocol + '//' + window.location.hostname + ':8765';
    
    let ws = null;
    let isListening = false;
    let isConnected = false;
    let sessionStart = Date.now();
    let messageCount = 0;

    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const avatar = document.getElementById('avatar');
    const transcript = document.getElementById('transcript');
    const conversation = document.getElementById('conversation');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const visualizerBars = document.querySelectorAll('.bar');

    function connect() {
      ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        isConnected = true;
        statusDot.className = 'status-dot connected';
        statusText.textContent = 'Connected';
        console.log('Connected to War Room');
      };
      
      ws.onclose = () => {
        isConnected = false;
        statusDot.className = 'status-dot';
        statusText.textContent = 'Disconnected';
        console.log('Disconnected from War Room');
        
        // Attempt reconnect
        setTimeout(connect, 3000);
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleMessage(data);
        } catch (e) {
          console.error('Error parsing message:', e);
        }
      };
    }

    function handleMessage(data) {
      switch (data.type) {
        case 'transcription':
          showTranscript(data.text, 'user');
          break;
        case 'text':
          showTranscript(data.text, 'claude');
          speakText(data.text);
          break;
        case 'audio':
          playAudio(data.data);
          break;
        case 'status':
          console.log('Status:', data.status);
          break;
      }
    }

    function showTranscript(text, speaker) {
      const label = speaker === 'user' ? 'You said' : 'Claude';
      transcript.innerHTML = \`
        <div class="label">\${label}</div>
        <div class="text">\${text}</div>
      \`;
      transcript.className = 'transcript ' + speaker;
      
      // Add to conversation
      const time = new Date().toLocaleTimeString();
      conversation.innerHTML += \`
        <div class="message \${speaker}">
          <div>\${text}</div>
          <div class="time">\${time}</div>
        </div>
      \`;
      conversation.scrollTop = conversation.scrollHeight;
      
      messageCount++;
      document.getElementById('msgCount').textContent = messageCount;
    }

    function startListening() {
      if (!ws || !isConnected) {
        alert('Not connected to War Room');
        return;
      }
      
      ws.send(JSON.stringify({ type: 'start_recording' }));
      isListening = true;
      startBtn.disabled = true;
      stopBtn.disabled = false;
      avatar.classList.add('listening');
      transcript.innerHTML = '<div class="label">Listening...</div><div class="text">Speak now</div>';
    }

    function stopListening() {
      if (!ws || !isConnected) return;
      
      ws.send(JSON.stringify({ type: 'stop_recording' }));
      isListening = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      avatar.classList.remove('listening');
    }

    function speakText(text) {
      avatar.classList.add('speaking');
      
      // Use Web Speech API for TTS
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => {
          avatar.classList.remove('speaking');
        };
        speechSynthesis.speak(utterance);
      }
    }

    function playAudio(base64Data) {
      // Play received audio data
      const audioBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      const audioBlob = new Blob([audioBytes], { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.play();
    }

    // Simulate audio visualization
    function animateVisualizer() {
      if (isListening) {
        visualizerBars.forEach(bar => {
          bar.style.height = Math.random() * 50 + 10 + 'px';
        });
      } else {
        visualizerBars.forEach(bar => {
          bar.style.height = '10px';
        });
      }
      requestAnimationFrame(animateVisualizer);
    }

    // Update duration
    function updateDuration() {
      const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      document.getElementById('duration').textContent = mins + ':' + secs.toString().padStart(2, '0');
    }

    // Event listeners
    startBtn.addEventListener('click', startListening);
    stopBtn.addEventListener('click', stopListening);

    // Initialize
    connect();
    animateVisualizer();
    setInterval(updateDuration, 1000);
  </script>
</body>
</html>`;
}