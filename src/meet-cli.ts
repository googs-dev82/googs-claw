#!/usr/bin/env node

import { logger } from './logger.js';
import { orchestrator } from './orchestrator.js';
import {
  createMeetSession,
  getMeetSession,
  getMeetSessions,
  updateMeetSession,
  type MeetSession,
} from './db.js';
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case 'start':
      startMeeting();
      break;
    case 'list':
      listMeetings();
      break;
    case 'summary':
      await generateSummary();
      break;
    case 'transcribe':
      await transcribeMeeting();
      break;
    default:
      showUsage();
  }
}

function startMeeting(): void {
  const meetingUrl = args[1];
  const provider = args[2] || 'meet';

  if (!meetingUrl) {
    console.error('Usage: meet-cli.ts start <meetingUrl> [provider]');
    process.exit(1);
  }

  const id = createMeetSession({
    meeting_url: meetingUrl,
    meeting_title: provider,
    briefing: null,
    summary: null,
    status: 'active',
    created_at: Date.now(),
  });

  console.log(`Meeting session started: ${id}`);
  console.log(`URL: ${meetingUrl}`);
}

function listMeetings(): void {
  const sessions = getMeetSessions();
  if (sessions.length === 0) {
    console.log('No meeting sessions');
    return;
  }

  for (const session of sessions) {
    console.log(formatSession(session));
  }
}

async function generateSummary(): Promise<void> {
  const sessionId = Number(args[1]);
  if (!Number.isFinite(sessionId)) {
    console.error('Usage: meet-cli.ts summary <numericSessionId>');
    process.exit(1);
  }

  const session = getMeetSession(sessionId);
  if (!session) {
    console.error(`Session ${sessionId} not found`);
    process.exit(1);
  }

  const briefing = session.briefing || 'No transcript or briefing was recorded for this session.';
  const result = await orchestrator.runWithContext(
    String(sessionId),
    `Summarize this meeting context and extract action items:\n\n${briefing}`,
    'main',
    false
  );

  updateMeetSession(sessionId, {
    summary: result.content,
    status: 'completed',
    completed_at: Date.now(),
  });

  console.log(result.content);
}

async function transcribeMeeting(): Promise<void> {
  const sessionId = Number(args[1]);
  const audioFile = args[2];

  if (!Number.isFinite(sessionId) || !audioFile) {
    console.error('Usage: meet-cli.ts transcribe <numericSessionId> <audioFile>');
    process.exit(1);
  }

  const session = getMeetSession(sessionId);
  if (!session) {
    console.error(`Session ${sessionId} not found`);
    process.exit(1);
  }

  const { speechToText } = await import('./voice.js');
  const transcription = await speechToText(readFileSync(audioFile));
  const existing = session.briefing ? `${session.briefing}\n` : '';

  updateMeetSession(sessionId, {
    briefing: `${existing}${transcription}`,
  });

  console.log(transcription);
}

function formatSession(session: MeetSession): string {
  return `${session.id} | ${session.status} | ${session.meeting_title || 'meeting'} | ${session.meeting_url}`;
}

function showUsage(): void {
  console.log(`
ClaudeClaw Meeting Bot CLI

Usage:
  meet-cli.ts start <meetingUrl> [provider]
  meet-cli.ts list
  meet-cli.ts summary <numericSessionId>
  meet-cli.ts transcribe <numericSessionId> <audioFile>
`);
}

main().catch((error) => {
  logger.error({ error }, 'Meet CLI error');
  console.error(error);
  process.exit(1);
});
