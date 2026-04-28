# ClaudeClaw OS v2 Operations

## Build and Test

```bash
npm run build
npm test
npm run doctor
```

## Main Runtime

```bash
npm start
```

The compiled entrypoint is `dist/src/index.js`. Runtime state should resolve to the project root and store data in `store/claudeclaw.db`.

## Per-Agent Runtime

Create an agent:

```bash
npm run agent:create
```

Start a single agent process:

```bash
npm run agent:start -- --agent=research
```

In agent mode, ClaudeClaw starts only the agent Telegram bot by default. It skips singleton/background services such as dashboard, scheduler, Slack, WhatsApp, War Room, and memory loops.

Telegram token resolution order:

1. Agent config stored in the database.
2. `{AGENT_ID}_TELEGRAM_TOKEN` from environment, for example `RESEARCH_TELEGRAM_TOKEN`.
3. `TELEGRAM_BOT_TOKEN` fallback.

## Dashboard

```bash
npm run dashboard
```

Default URL: `http://localhost:3141`.

Set `DASHBOARD_AUTH_TOKEN` before exposing the dashboard outside a trusted local environment. API requests must send one of:

- `Authorization: Bearer <token>`
- `X-Dashboard-Token: <token>`
- `?token=<token>` for EventSource clients.

The dashboard exposes `/api/events` as a Server-Sent Events stream. Current event types:

- `connected`
- `ping`
- `memory.deleted`
- `task.created`
- `task.deleted`
- `agent.scaffolded`
- `warroom.started`
- `warroom.stopped`

## Backup and Restore

Create a database backup:

```bash
npm run backup
```

List backups:

```bash
npm run backup:list
```

Restore a backup:

```bash
npm run restore -- claudeclaw-YYYY-MM-DDTHH-MM-SS-sssZ.db
```

Backups are written to `backups/`, which is intentionally ignored by git.

## War Room

Install Python dependencies:

```bash
cd warroom
python3 -m pip install -r requirements.txt
```

Start the War Room server:

```bash
npm run warroom
```

Required or optional environment variables depend on the selected mode:

- `GOOGLE_API_KEY` for Gemini mode.
- `OPENAI_API_KEY` for OpenAI STT/TTS fallback in the current scaffold.
- `WARROOM_PORT` to override the default.

The current War Room implementation is a Pipecat scaffold and still requires browser/audio hardware validation before production use.
