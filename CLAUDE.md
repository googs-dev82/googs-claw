# ClaudeClaw OS v2

A personal AI assistant that runs locally and can be controlled from your phone via Telegram. Features multi-agent architecture, voice support, persistent memory, and more.

## Features

### Core
- **Telegram Bot** - Control Claude from your phone
- **Multi-Agent System** - Specialized agents for different tasks
- **Persistent Memory** - Long-term memory with semantic search
- **Voice Support** - Speech-to-text and text-to-speech

### Optional Integrations
- **WhatsApp** - Connect via whatsapp-web.js
- **Slack** - Slash commands and app mentions
- **War Room** - Real-time voice conversation
- **Meeting Bot** - Record and summarize meetings
- **Calendar Scheduling** - Create Google Calendar events or local invite drafts
- **Dashboard** - Web UI for monitoring

### Advanced
- **Security** - Rate limiting, authorization, exfiltration guard
- **Scheduler** - Automated recurring tasks
- **Mission Control** - Queue-based task execution

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required variables:
- `TELEGRAM_API_ID` - Get from my.telegram.org
- `TELEGRAM_API_HASH` - Get from my.telegram.org
- `TELEGRAM_BOT_TOKEN` - Get from @BotFather
- `ANTHROPIC_API_KEY` - Get from anthropic.com
- `GOOGLE_API_KEY` - Get from Google AI Studio (for memory embeddings)

Optional variables:
- `WHATSAPP_ENABLED=true` - Enable WhatsApp
- `SLACK_ENABLED=true` - Enable Slack
- `WARROOM_ENABLED=true` - Enable War Room voice
- `DASHBOARD_ENABLED=true` - Enable dashboard
- `GOOGLE_CALENDAR_ID=primary` - Google Calendar target calendar
- `GOOGLE_CALENDAR_TIMEZONE=Asia/Riyadh` - Default event timezone
- `GOOGLE_CALENDAR_ACCESS_TOKEN` / `GOOGLE_CALENDAR_REFRESH_TOKEN` - Google Calendar auth
- `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET` - Needed for refresh flow

### 3. Run

```bash
npm run build
npm start
```

### 4. Authorize Users

Start a chat with your bot and it will automatically authorize you. To add more users, use the security module or edit the database directly.

## Project Structure

```
src/
├── index.ts           # Main entry point
├── bot.ts             # Telegram bot implementation
├── orchestrator.ts    # Agent orchestration
├── agent.ts           # Claude Agent SDK wrapper
├── agent-config.ts    # Agent configuration loader
├── memory.ts          # Memory retrieval
├── memory-ingest.ts   # Memory ingestion
├── memory-consolidate.ts # Memory consolidation
├── embeddings.ts      # Semantic embeddings
├── gemini.ts          # Gemini API client
├── voice.ts           # Voice (STT/TTS)
├── media.ts           # Media processing
├── security.ts        # Security & authorization
├── exfiltration-guard.ts # Prompt injection protection
├── scheduler.ts       # Task scheduler
├── dashboard.ts       # Dashboard API
├── whatsapp.ts        # WhatsApp integration
├── slack.ts           # Slack integration
├── agent-voice-bridge.ts # War Room bridge
├── db.ts              # Database (SQLite)
├── logger.ts          # Logging
├── config.ts          # Configuration
└── state.ts           # State management

warroom/
└── warroom_voice.py   # War Room voice server

agents/
└── *.yaml             # Agent configurations
```

## Commands

### Telegram Bot
- `/start` - Start the bot
- `/help` - Show help
- `/status` - System status
- `/memory` - Memory stats
- `/history` - Conversation history
- `/voice` - Voice status
- `/tasks` - Scheduled tasks
- `/dashboard` - Dashboard URL
- `/warroom` - Start War Room

### CLI Tools

```bash
# Schedule tasks
npm run schedule -- list
npm run schedule -- add daily-briefing 123456789 "0 9 * * *" "Give me a summary"

# Mission control
npm run mission -- list
npm run mission -- add research1 123456789 main 2 "Research AI trends"

# Meeting bot
npm run meet -- start abc123 zoom
npm run meet -- list
npm run meet -- summary meet_1234567890
```

## Memory System

ClaudeClaw uses a sophisticated memory system:

1. **Short-term** - Recent conversation turns (last 50)
2. **Working** - Important context from current session
3. **Semantic** - Embeddings-based retrieval
4. **Long-term** - Consolidated important memories
5. **Archive** - Low-importance historical data

Memory is automatically consolidated every hour, and decay removes irrelevant memories.

## Multi-Agent System

Define agents in `agents/agent.yaml`:

```yaml
agents:
  - id: main
    name: Main Agent
    model: claude-sonnet-4-20250514
    system_prompt: "You are a helpful assistant..."
    
  - id: comms
    name: Communications
    model: claude-sonnet-4-20250514
    system_prompt: "You handle communications..."
    
  - id: research
    name: Research
    model: claude-sonnet-4-20250514
    system_prompt: "You research topics..."

  - id: fullstack
    name: Full Stack Engineer
    model: claude-sonnet-4-20250514
    system_prompt: "You design, debug, and update software projects across the stack."
```

## Voice

### STT (Speech-to-Text)
Uses Groq Whisper for fast transcription.

### TTS (Text-to-Speech)
Uses Kokoro for natural-sounding voice output.

Configure in `.env`:
```
GROQ_API_KEY=your_key
KOKORO_VOICE=af_sarah
```

## War Room

Real-time voice conversation with Claude:

1. Start the voice server:
```bash
cd warroom
pip install -r requirements.txt
python warroom_voice.py --tts kokoro
```

2. Connect from browser or client
3. Speak naturally with Claude

## Dashboard

Web UI for monitoring:

- System status
- Memory stats
- Security metrics
- Scheduler tasks
- Token usage
- Memory search

Access at `http://localhost:3001` (or configured port).

## Security

- **Authorization** - Whitelist of allowed users
- **Rate Limiting** - Prevent spam/abuse
- **Exfiltration Guard** - Block prompt injection
- **Input Sanitization** - Clean user input
- **Audit Logging** - Track all activity

## Troubleshooting

### Bot not responding
1. Check API credentials in `.env`
2. Verify bot token with @BotFather
3. Check logs for errors

### Memory issues
1. Ensure `GOOGLE_API_KEY` is set
2. Check database permissions
3. Review memory stats with `/memory` command

### Voice not working
1. Verify Groq API key
2. Check audio permissions
3. Test with `/voice` command

### WhatsApp QR not scanning
1. Clear `.wwebjs_auth` folder
2. Restart the bot
3. Scan QR again

## Development

### Build
```bash
npm run build
```

### TypeScript Watch
```bash
npm run dev
```

### Run Tests
```bash
npm test
```

### Lint
```bash
npm run lint
```

## License

MIT
