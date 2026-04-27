import {
  query,
  SDKMessage,
  Options,
} from '@anthropic-ai/claude-agent-sdk';
import cronParser from 'cron-parser';
import { randomUUID } from 'crypto';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import { createTask, logTokenUsage } from './db.js';
import { STORE_DIR } from './config.js';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'fs';
import { resolve, relative, join, dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const env = readEnvFile();
const execAsync = promisify(exec);
const { parseExpression } = cronParser;
const ANTHROPIC_API_KEY = env['ANTHROPIC_API_KEY'] ?? '';
const DEFAULT_MODEL = env['DEFAULT_MODEL'] ?? 'claude-sonnet-4-6';
const LLM_PROVIDER = (env['LLM_PROVIDER'] ?? 'claude').toLowerCase();
const OLLAMA_BASE_URL = env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434';
const OLLAMA_MODEL = env['OLLAMA_MODEL'] ?? DEFAULT_MODEL;
const OPENROUTER_API_KEY = env['OPENROUTER_API_KEY'] ?? '';
const OPENROUTER_MODEL = env['OPENROUTER_MODEL'] ?? DEFAULT_MODEL;
const OPENROUTER_BASE_URL = env['OPENROUTER_BASE_URL'] ?? 'https://openrouter.ai/api/v1';
const PROVIDER_TOOLS_ENABLED = env['PROVIDER_TOOLS_ENABLED']?.toLowerCase() !== 'false';
const TOOL_ALLOW_BASH = env['TOOL_ALLOW_BASH']?.toLowerCase() === 'true';
const TOOL_ALLOW_EDIT = env['TOOL_ALLOW_EDIT']?.toLowerCase() === 'true';
const TOOL_ROOT = resolve(env['TOOL_ROOT'] ?? process.cwd());
const TOOL_TIMEOUT_MS = parseInt(env['TOOL_TIMEOUT_MS'] ?? '30000', 10);
const TOOL_MAX_LOOPS = parseInt(env['TOOL_MAX_LOOPS'] ?? '5', 10);
const GOOGLE_CALENDAR_ACCESS_TOKEN = env['GOOGLE_CALENDAR_ACCESS_TOKEN'] ?? '';
const GOOGLE_CALENDAR_REFRESH_TOKEN = env['GOOGLE_CALENDAR_REFRESH_TOKEN'] ?? '';
const GOOGLE_CALENDAR_CLIENT_ID = env['GOOGLE_CALENDAR_CLIENT_ID'] ?? '';
const GOOGLE_CALENDAR_CLIENT_SECRET = env['GOOGLE_CALENDAR_CLIENT_SECRET'] ?? '';
const GOOGLE_CALENDAR_ID = env['GOOGLE_CALENDAR_ID'] ?? 'primary';
const GOOGLE_CALENDAR_TIMEZONE = env['GOOGLE_CALENDAR_TIMEZONE'] ?? 'Asia/Riyadh';

export interface AgentConfig {
  model: string;
  maxTokens: number;
  temperature: number;
  systemPrompt?: string;
}

export interface AgentResult {
  content: string;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  duration: number;
}

/**
 * Interface for Agent Runtime configuration
 */
export interface AgentRuntime {
  systemPrompt: string;
  config: Partial<AgentConfig>;
  chatId?: string;
}

interface RunContext {
  chatId?: string;
}

/**
 * Create a Claude Agent runtime configuration
 */
export function createAgentRuntime(
  systemPrompt: string,
  tools: any[] = [], // Tools handling changed significantly in 0.2.x
  config: Partial<AgentConfig> = {},
  context: RunContext = {}
): AgentRuntime {
  return {
    systemPrompt,
    config,
    chatId: context.chatId,
  };
}

/**
 * Run the agent with a user message
 */
export async function runAgent(
  runtime: AgentRuntime,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onEvent?: (event: SDKMessage) => void,
  context: RunContext = {}
): Promise<AgentResult> {
  const startTime = Date.now();
  let toolCalls = 0;
  let accumulatedContent = '';
  let usage = { input_tokens: 0, output_tokens: 0 };

  // For this implementation, we take the last message as the prompt.
  // To support full history, we would need to manage session_ids or use AsyncIterable.
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) {
    throw new Error('No messages provided to agent');
  }

  if (LLM_PROVIDER === 'ollama') {
    return runOllamaAgent(runtime, messages, startTime, context);
  }

  if (LLM_PROVIDER === 'openrouter') {
    return runOpenRouterAgent(runtime, messages, startTime, context);
  }

  if (LLM_PROVIDER !== 'claude') {
    throw new Error(`Unsupported LLM_PROVIDER "${LLM_PROVIDER}". Use claude, ollama, or openrouter.`);
  }

  const options: Options = {
    model: runtime.config.model ?? DEFAULT_MODEL,
    agent: 'claudeclaw',
    agents: {
      claudeclaw: {
        description: 'ClaudeClaw local assistant',
        prompt: runtime.systemPrompt,
        tools: ['Bash', 'Read', 'Edit', 'Grep', 'Glob', 'LS'],
      },
    },
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: ANTHROPIC_API_KEY || (process.env.ANTHROPIC_API_KEY ?? ''),
    },
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    // Ensure we don't prompt for tools if we want autonomous behavior
    allowedTools: ['Bash', 'Read', 'Edit', 'Grep', 'Glob', 'LS'], 
    tools: { type: 'preset', preset: 'claude_code' },
  };

  try {
    const q = query({ 
      prompt: lastMessage.content, 
      options 
    });

    for await (const message of q) {
      if (onEvent) {
        onEvent(message);
      }

      switch (message.type) {
        case 'stream_event':
          if (message.event.type === 'content_block_delta' && message.event.delta.type === 'text_delta') {
            accumulatedContent += message.event.delta.text;
          }
          break;
        case 'assistant':
          // Count tool calls in the message content
          message.message.content.forEach(block => {
            if (block.type === 'tool_use') {
              toolCalls++;
            }
          });
          break;
        case 'result':
          if (message.subtype === 'success') {
            usage = {
              input_tokens: message.usage.input_tokens || 0,
              output_tokens: message.usage.output_tokens || 0,
            };
          }
          break;
      }
    }

    const duration = Date.now() - startTime;

    return {
      content: accumulatedContent,
      toolCalls,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      duration,
    };
  } catch (error) {
    logger.error({ error, duration: Date.now() - startTime }, 'Agent run failed');
    throw error;
  }
}

function buildChatMessages(
  runtime: AgentRuntime,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  toolsAvailable: boolean = true
): ChatMessage[] {
  const toolScopeNote = PROVIDER_TOOLS_ENABLED && toolsAvailable
    ? `\n\nTool scope: file tools are limited to ${TOOL_ROOT}. Do not try to access parent directories or paths outside that root. If you need something outside the root, explain that limitation to the user.`
    : '';
  const scheduleNote = PROVIDER_TOOLS_ENABLED && toolsAvailable
    ? `\n\nA Schedule tool is available for recurring tasks in the current chat. Use it when the user asks to set something to happen later or on a repeating cadence.`
    : '';
  const calendarNote = PROVIDER_TOOLS_ENABLED && toolsAvailable
    ? `\n\nA Calendar tool is available for meeting and event scheduling. Use it only when the user is actually asking to create or update a calendar event or meeting. Do not call it for unrelated requests.`
    : '';

  return [
    { role: 'system', content: `${runtime.systemPrompt}\n\nYou may use tools when available. Keep tool use focused and explain results clearly.${toolScopeNote}${scheduleNote}${calendarNote}` },
    ...messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];
}

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

type ToolCall = {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

const providerTools = [
  {
    type: 'function',
    function: {
      name: 'LS',
      description: 'List files and directories under the project workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative path. Defaults to .' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'MakeDir',
      description: 'Create a directory inside the workspace, including any missing parent directories.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative directory path.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Write',
      description: 'Create or replace a workspace file with the provided content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
          content: { type: 'string', description: 'Complete file content to write.' },
          overwrite: { type: 'boolean', description: 'If true, replace an existing file. Defaults to true.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Read',
      description: 'Read a text file from the project workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          offset: { type: 'number', description: 'Starting line number, 1-based.' },
          limit: { type: 'number', description: 'Maximum number of lines.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Grep',
      description: 'Search text in files under the project workspace using ripgrep.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string', description: 'Workspace-relative path. Defaults to .' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Schedule',
      description: 'Create a recurring scheduled task for the current chat.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What the agent should do when the task runs.' },
          schedule: { type: 'string', description: 'Cron expression for when the task should run.' },
          agentId: { type: 'string', description: 'Agent to run for the task. Defaults to main.' },
          priority: { type: 'number', description: 'Lower numbers run first.' },
          id: { type: 'string', description: 'Optional task ID. If omitted, one is generated.' },
        },
        required: ['prompt', 'schedule'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Calendar',
      description: 'Create a calendar event or meeting. Uses Google Calendar when configured, otherwise creates a local invite draft.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Event title or meeting subject.' },
          start: { type: 'string', description: 'Event start time in ISO 8601 format.' },
          end: { type: 'string', description: 'Event end time in ISO 8601 format. Defaults to one hour after start.' },
          timezone: { type: 'string', description: 'IANA timezone name. Defaults to GOOGLE_CALENDAR_TIMEZONE.' },
          description: { type: 'string', description: 'Optional event description or agenda.' },
          location: { type: 'string', description: 'Optional meeting location or video call URL.' },
          attendees: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional attendee email addresses.',
          },
          conference: { type: 'boolean', description: 'Create a Google Meet link when Google Calendar is used.' },
          calendarId: { type: 'string', description: 'Calendar ID. Defaults to GOOGLE_CALENDAR_ID.' },
          id: { type: 'string', description: 'Optional event ID for the local draft path.' },
        },
        required: ['title', 'start'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Bash',
      description: 'Run a shell command in the project workspace. Requires TOOL_ALLOW_BASH=true.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Edit',
      description: 'Replace exact text in a workspace file. Requires TOOL_ALLOW_EDIT=true.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          search: { type: 'string' },
          replace: { type: 'string' },
        },
        required: ['path', 'search', 'replace'],
      },
    },
  },
];

function resolveToolPath(inputPath: string = '.'): { ok: true; path: string } | { ok: false; reason: string } {
  const resolved = resolve(TOOL_ROOT, inputPath);
  const rel = relative(TOOL_ROOT, resolved);
  if (rel.startsWith('..') || resolve(rel) === rel) {
    return { ok: false, reason: `Path outside TOOL_ROOT is not allowed: ${inputPath}` };
  }
  return { ok: true, path: resolved };
}

function parseToolArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function ensureParentDir(filePath: string): void {
  const parent = dirname(filePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function formatIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function getCalendarDraftDir(): string {
  const dir = join(STORE_DIR, 'calendar');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function safeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'event';
}

function buildLocalInviteDraft(args: Record<string, unknown>): string {
  const title = String(args.title ?? '').trim();
  const start = String(args.start ?? '').trim();
  const end = String(args.end ?? '').trim();
  const description = String(args.description ?? '').trim();
  const location = String(args.location ?? '').trim();
  const attendees = Array.isArray(args.attendees)
    ? args.attendees.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const conference = Boolean(args.conference);
  const timezone = String(args.timezone ?? GOOGLE_CALENDAR_TIMEZONE).trim() || GOOGLE_CALENDAR_TIMEZONE;
  const eventId = String(args.id ?? `event_${Date.now()}_${randomUUID().slice(0, 8)}`).trim();

  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) {
    throw new Error(`Invalid start time: ${start}`);
  }

  const endDate = end ? new Date(end) : new Date(startDate.getTime() + 60 * 60 * 1000);
  if (Number.isNaN(endDate.getTime())) {
    throw new Error(`Invalid end time: ${end}`);
  }

  const uid = `${eventId}@claudeclaw.local`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ClaudeClaw//Calendar Draft//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(startDate)}`,
    `DTEND:${formatIcsDate(endDate)}`,
    `SUMMARY:${escapeIcsText(title || 'Untitled event')}`,
    description ? `DESCRIPTION:${escapeIcsText(description)}` : '',
    location ? `LOCATION:${escapeIcsText(location)}` : '',
    conference ? `COMMENT:${escapeIcsText('Google Meet link requested when published to Google Calendar')}` : '',
    attendees.map((attendee) => `ATTENDEE:mailto:${escapeIcsText(attendee)}`).join('\n'),
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  const draftDir = getCalendarDraftDir();
  const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeSlug(title)}.ics`;
  const filePath = join(draftDir, fileName);
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');

  return [
    'Google Calendar is not configured, so I created a local invite draft instead.',
    `Draft file: ${filePath}`,
    `Title: ${title}`,
    `Start: ${startDate.toISOString()}`,
    `End: ${endDate.toISOString()}`,
    `Timezone: ${timezone}`,
    attendees.length ? `Attendees: ${attendees.join(', ')}` : 'Attendees: none',
    conference ? 'Conference: requested' : 'Conference: not requested',
  ].join('\n');
}

async function getGoogleCalendarAccessToken(): Promise<string | null> {
  if (GOOGLE_CALENDAR_ACCESS_TOKEN) {
    return GOOGLE_CALENDAR_ACCESS_TOKEN;
  }

  if (!GOOGLE_CALENDAR_REFRESH_TOKEN || !GOOGLE_CALENDAR_CLIENT_ID || !GOOGLE_CALENDAR_CLIENT_SECRET) {
    return null;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: GOOGLE_CALENDAR_CLIENT_SECRET,
      refresh_token: GOOGLE_CALENDAR_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google token refresh failed ${response.status}: ${errorText}`);
  }

  const data = await response.json() as { access_token?: string };
  return data.access_token ?? null;
}

async function createGoogleCalendarEvent(args: Record<string, unknown>): Promise<string> {
  const title = String(args.title ?? '').trim();
  const start = String(args.start ?? '').trim();
  const end = String(args.end ?? '').trim();
  const description = String(args.description ?? '').trim();
  const location = String(args.location ?? '').trim();
  const attendees = Array.isArray(args.attendees)
    ? args.attendees.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const conference = Boolean(args.conference);
  const timezone = String(args.timezone ?? GOOGLE_CALENDAR_TIMEZONE).trim() || GOOGLE_CALENDAR_TIMEZONE;
  const calendarId = String(args.calendarId ?? GOOGLE_CALENDAR_ID).trim() || GOOGLE_CALENDAR_ID;

  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) {
    throw new Error(`Invalid start time: ${start}`);
  }

  const endDate = end ? new Date(end) : new Date(startDate.getTime() + 60 * 60 * 1000);
  if (Number.isNaN(endDate.getTime())) {
    throw new Error(`Invalid end time: ${end}`);
  }

  const accessToken = await getGoogleCalendarAccessToken();
  if (!accessToken) {
    return buildLocalInviteDraft(args);
  }

  const body: Record<string, unknown> = {
    summary: title || 'Untitled event',
    description: description || undefined,
    location: location || undefined,
    start: {
      dateTime: startDate.toISOString(),
      timeZone: timezone,
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone: timezone,
    },
    attendees: attendees.map((email) => ({ email })),
  };

  if (conference) {
    body.conferenceData = {
      createRequest: {
        requestId: randomUUID(),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  if (conference) {
    url.searchParams.set('conferenceDataVersion', '1');
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return `Google Calendar event creation failed ${response.status}: ${errorText}\n\nCreated local draft instead.\n${buildLocalInviteDraft(args)}`;
  }

  const event = await response.json() as {
    htmlLink?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: Array<{ uri?: string }> };
  };

  const meetLink = event.hangoutLink
    ?? event.conferenceData?.entryPoints?.find((entry) => entry.uri)?.uri
    ?? null;

  return [
    'Google Calendar event created successfully.',
    event.htmlLink ? `Event: ${event.htmlLink}` : 'Event: created',
    meetLink ? `Meeting link: ${meetLink}` : 'Meeting link: none',
    `Title: ${title}`,
    `Start: ${startDate.toISOString()}`,
    `End: ${endDate.toISOString()}`,
    `Calendar: ${calendarId}`,
  ].join('\n');
}

async function executeProviderTool(
  name: string,
  args: Record<string, unknown>,
  context: RunContext
): Promise<string> {
  switch (name) {
    case 'LS': {
      const dirResult = resolveToolPath(String(args.path ?? '.'));
      if (!dirResult.ok) return dirResult.reason;
      const dir = dirResult.path;
      const entries = readdirSync(dir).slice(0, 200).map((entry) => {
        const full = join(dir, entry);
        const stat = statSync(full);
        return `${stat.isDirectory() ? 'dir ' : 'file'} ${entry}`;
      });
      return entries.join('\n') || '(empty)';
    }
    case 'MakeDir': {
      const inputPath = String(args.path ?? '').trim();
      if (!inputPath || inputPath === '.' || inputPath === './') {
        return 'MakeDir requires a directory path, not the workspace root.';
      }

      const dirResult = resolveToolPath(inputPath);
      if (!dirResult.ok) return dirResult.reason;
      const dir = dirResult.path;
      if (existsSync(dir) && statSync(dir).isFile()) {
        return `MakeDir cannot create ${relative(TOOL_ROOT, dir)} because a file already exists there.`;
      }

      mkdirSync(dir, { recursive: true });
      return `Created directory ${relative(TOOL_ROOT, dir)}`;
    }
    case 'Write': {
      const inputPath = String(args.path ?? '').trim();
      if (!inputPath || inputPath === '.' || inputPath === './') {
        return 'Write requires a file path, not a directory. Provide a filename such as src/new-file.ts.';
      }

      const fileResult = resolveToolPath(inputPath);
      if (!fileResult.ok) return fileResult.reason;
      const file = fileResult.path;
      const content = String(args.content ?? '');
      const overwrite = args.overwrite === false ? false : true;
      if (existsSync(file) && statSync(file).isDirectory()) {
        return `Write requires a file path, but ${relative(TOOL_ROOT, file)} is a directory.`;
      }
      if (existsSync(file) && !overwrite) {
        return `File already exists: ${relative(TOOL_ROOT, file)}. Set overwrite=true to replace it.`;
      }
      ensureParentDir(file);
      writeFileSync(file, content, 'utf8');
      return `Wrote ${relative(TOOL_ROOT, file)} (${content.length} chars)`;
    }
    case 'Read': {
      const fileResult = resolveToolPath(String(args.path ?? ''));
      if (!fileResult.ok) return fileResult.reason;
      const file = fileResult.path;
      const offset = Math.max(1, Number(args.offset ?? 1));
      const limit = Math.min(500, Math.max(1, Number(args.limit ?? 200)));
      const lines = readFileSync(file, 'utf8').split('\n');
      return lines.slice(offset - 1, offset - 1 + limit)
        .map((line, index) => `${offset + index}: ${line}`)
        .join('\n');
    }
    case 'Grep': {
      const pattern = String(args.pattern ?? '');
      const searchPathResult = resolveToolPath(String(args.path ?? '.'));
      if (!searchPathResult.ok) return searchPathResult.reason;
      const searchPath = searchPathResult.path;
      if (!pattern) throw new Error('Grep requires pattern');
      const { stdout, stderr } = await execAsync(`rg -n -- ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)}`, {
        cwd: TOOL_ROOT,
        timeout: TOOL_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      }).catch((error) => ({ stdout: error.stdout ?? '', stderr: error.stderr ?? error.message }));
      return String(stdout || stderr || '(no matches)').slice(0, 20000);
    }
    case 'Schedule': {
      const chatId = context.chatId;
      if (!chatId) {
        return 'Schedule tool requires chat context, but none was available.';
      }

      const prompt = String(args.prompt ?? '').trim();
      const schedule = String(args.schedule ?? '').trim();
      const agentId = String(args.agentId ?? 'main').trim() || 'main';
      const priorityNumber = Number(args.priority ?? 3);
      const priority = Number.isFinite(priorityNumber) ? priorityNumber : 3;
      const taskId = String(args.id ?? `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`).trim();

      if (!prompt) {
        throw new Error('Schedule requires prompt');
      }

      if (!schedule) {
        throw new Error('Schedule requires schedule');
      }

      try {
        parseExpression(schedule);
      } catch {
        return `Invalid cron expression: ${schedule}`;
      }

      const nextRun = parseExpression(schedule).next().toDate();
      createTask({
        id: taskId,
        chat_id: chatId,
        prompt,
        schedule,
        next_run: nextRun.getTime(),
        last_run: null,
        last_result: null,
        priority,
        agent_id: agentId,
        status: 'active',
      });

      return [
        `Scheduled task created: ${taskId}`,
        `Chat: ${chatId}`,
        `Agent: ${agentId}`,
        `Priority: ${priority}`,
        `Next run: ${nextRun.toISOString()}`,
      ].join('\n');
    }
    case 'Calendar': {
      const title = String(args.title ?? '').trim();
      const start = String(args.start ?? '').trim();
      if (!title) {
        return 'Calendar tool was called without a title. Ask the user for the meeting or event title before creating it.';
      }
      if (!start) {
        return 'Calendar tool was called without a start time. Ask the user when the meeting or event should begin.';
      }
      return createGoogleCalendarEvent(args);
    }
    case 'Bash': {
      if (!TOOL_ALLOW_BASH) {
        return 'Bash tool is disabled. Set TOOL_ALLOW_BASH=true in .env to enable it.';
      }
      const command = String(args.command ?? '');
      if (!command) throw new Error('Bash requires command');
      const { stdout, stderr } = await execAsync(command, {
        cwd: TOOL_ROOT,
        timeout: TOOL_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      });
      return String(stdout || stderr || '(command completed with no output)').slice(0, 20000);
    }
    case 'Edit': {
      if (!TOOL_ALLOW_EDIT) {
        return 'Edit tool is disabled. Set TOOL_ALLOW_EDIT=true in .env to enable it.';
      }
      const fileResult = resolveToolPath(String(args.path ?? ''));
      if (!fileResult.ok) return fileResult.reason;
      const file = fileResult.path;
      const search = String(args.search ?? '');
      const replace = String(args.replace ?? '');
      if (!search) throw new Error('Edit requires search text');
      const current = readFileSync(file, 'utf8');
      if (!current.includes(search)) {
        throw new Error('Search text not found');
      }
      writeFileSync(file, current.replace(search, replace));
      return `Edited ${relative(TOOL_ROOT, file)}`;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function runOllamaAgent(
  runtime: AgentRuntime,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  startTime: number,
  context: RunContext
): Promise<AgentResult> {
  const model = runtime.config.model ?? OLLAMA_MODEL;
  const chatMessages = buildChatMessages(runtime, messages);
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let finalContent = '';

  for (let loop = 0; loop < TOOL_MAX_LOOPS; loop++) {
    const response = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: chatMessages,
        tools: PROVIDER_TOOLS_ENABLED ? providerTools : undefined,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as {
      message?: { content?: string; tool_calls?: ToolCall[] };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    inputTokens += data.prompt_eval_count ?? 0;
    outputTokens += data.eval_count ?? 0;
    finalContent = data.message?.content ?? '';
    const calls = data.message?.tool_calls ?? [];

    if (!PROVIDER_TOOLS_ENABLED || calls.length === 0) {
      break;
    }

    chatMessages.push({
      role: 'assistant',
      content: finalContent,
      tool_calls: calls,
    });

    for (const call of calls) {
      const name = call.function?.name ?? '';
      const result = await executeProviderTool(name, parseToolArgs(call.function?.arguments), context);
      toolCalls++;
      chatMessages.push({
        role: 'tool',
        tool_call_id: call.id ?? name,
        content: result,
      });
    }
  }

  return {
    content: finalContent,
    toolCalls,
    inputTokens,
    outputTokens,
    duration: Date.now() - startTime,
  };
}

async function runOpenRouterAgent(
  runtime: AgentRuntime,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  startTime: number,
  context: RunContext
): Promise<AgentResult> {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required when LLM_PROVIDER=openrouter');
  }

  try {
    return await runOpenRouterAgentOnce(runtime, messages, startTime, context, true);
  } catch (error) {
    if (PROVIDER_TOOLS_ENABLED && isLikelyOpenRouterToolError(error)) {
      logger.warn({ error }, 'OpenRouter tool request failed; retrying without tools');
      return await runOpenRouterAgentOnce(runtime, messages, startTime, context, false);
    }
    throw error;
  }
}

function isLikelyOpenRouterToolError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('OpenRouter error 400') &&
    (
      message.includes('Provider returned error') ||
      message.includes("Expecting ',' delimiter") ||
      message.includes('tool') ||
      message.includes('invalid')
    )
  );
}

async function runOpenRouterAgentOnce(
  runtime: AgentRuntime,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  startTime: number,
  context: RunContext,
  toolsAvailable: boolean
): Promise<AgentResult> {
  const model = runtime.config.model ?? OPENROUTER_MODEL;
  const chatMessages = buildChatMessages(runtime, messages, toolsAvailable);
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let finalContent = '';

  for (let loop = 0; loop < TOOL_MAX_LOOPS; loop++) {
    const response = await fetch(`${OPENROUTER_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': env['OPENROUTER_SITE_URL'] ?? 'http://localhost:3141',
        'X-Title': env['OPENROUTER_APP_NAME'] ?? 'ClaudeClaw',
      },
      body: JSON.stringify({
        model,
        messages: chatMessages,
        tools: PROVIDER_TOOLS_ENABLED && toolsAvailable ? providerTools : undefined,
        tool_choice: PROVIDER_TOOLS_ENABLED && toolsAvailable ? 'auto' : undefined,
        temperature: runtime.config.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    inputTokens += data.usage?.prompt_tokens ?? 0;
    outputTokens += data.usage?.completion_tokens ?? 0;
    const message = data.choices?.[0]?.message;
    finalContent = message?.content ?? '';
    const calls = message?.tool_calls ?? [];

    if (!PROVIDER_TOOLS_ENABLED || !toolsAvailable || calls.length === 0) {
      break;
    }

    chatMessages.push({
      role: 'assistant',
      content: finalContent,
      tool_calls: calls,
    });

    for (const call of calls) {
      const name = call.function?.name ?? '';
      const result = await executeProviderTool(name, parseToolArgs(call.function?.arguments), context);
      toolCalls++;
      chatMessages.push({
        role: 'tool',
        tool_call_id: call.id ?? name,
        content: result,
      });
    }
  }

  return {
    content: finalContent,
    toolCalls,
    inputTokens,
    outputTokens,
    duration: Date.now() - startTime,
  };
}

/**
 * Run agent with retry logic
 */
export async function runAgentWithRetry(
  runtime: AgentRuntime,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxRetries: number = 3,
  onEvent?: (event: SDKMessage) => void,
  context: RunContext = {}
): Promise<AgentResult> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await runAgent(runtime, messages, onEvent, context);
    } catch (error) {
      lastError = error as Error;
      
      // Check if error is retryable
      const errorMessage = (error as Error).message?.toLowerCase() ?? '';
      const retryable = 
        errorMessage.includes('rate_limit') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('429') ||
        errorMessage.includes('503');
      
      if (!retryable || attempt === maxRetries - 1) {
        throw error;
      }
      
      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000;
      logger.warn({ attempt, delay, error }, 'Retrying agent after error');
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Log agent usage to database
 */
export function logAgentUsage(
  chatId: string,
  model: string,
  result: AgentResult,
  agentId: string = 'main'
): void {
  const estimatedCost = (result.inputTokens * 0.000003) + (result.outputTokens * 0.000015);
  
  logTokenUsage(
    chatId,
    model,
    result.inputTokens,
    result.outputTokens,
    estimatedCost,
    agentId
  );
}

/**
 * Create a simple agent with basic tools
 */
export function createSimpleAgent(
  systemPrompt: string,
  tools: any[] = []
): AgentRuntime {
  return createAgentRuntime(systemPrompt, tools);
}

/**
 * Check if agent is configured
 */
export function isAgentConfigured(): boolean {
  return !!ANTHROPIC_API_KEY || !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Get default agent configuration
 */
export function getDefaultAgentConfig(): AgentConfig {
  return {
    model: DEFAULT_MODEL,
    maxTokens: 8192,
    temperature: 0.7,
  };
}
