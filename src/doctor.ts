#!/usr/bin/env node

import { existsSync, accessSync, constants } from 'fs';
import { join } from 'path';
import { PROJECT_ROOT, readEnvFile } from './env.js';
import { validateAgentId, getAllAgents } from './agent-config.js';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  message: string;
}

function hasValue(value?: string): boolean {
  return Boolean(value && value.trim());
}

function checkWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function runDoctor(env = readEnvFile()): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const storeDir = join(PROJECT_ROOT, 'store');
  const agentsDir = join(PROJECT_ROOT, 'agents');

  checks.push({
    name: 'Node.js',
    status: Number(process.versions.node.split('.')[0]) >= 20 ? 'pass' : 'fail',
    message: `Detected ${process.version}; Node.js 20+ is required.`,
  });

  checks.push({
    name: 'Project root',
    status: existsSync(join(PROJECT_ROOT, 'package.json')) ? 'pass' : 'fail',
    message: PROJECT_ROOT,
  });

  checks.push({
    name: 'Store directory',
    status: existsSync(storeDir) && checkWritable(storeDir) ? 'pass' : 'fail',
    message: existsSync(storeDir) ? `Writable: ${storeDir}` : `Missing: ${storeDir}`,
  });

  checks.push({
    name: 'Telegram token',
    status: hasValue(env['TELEGRAM_BOT_TOKEN']) ? 'pass' : 'fail',
    message: hasValue(env['TELEGRAM_BOT_TOKEN']) ? 'Configured' : 'TELEGRAM_BOT_TOKEN is required for the main bot.',
  });

  checks.push({
    name: 'Telegram allowlist',
    status: hasValue(env['ALLOWED_TELEGRAM_IDS']) ? 'pass' : 'warn',
    message: hasValue(env['ALLOWED_TELEGRAM_IDS']) ? 'Configured' : 'Set ALLOWED_TELEGRAM_IDS before exposing the bot.',
  });

  checks.push({
    name: 'Dashboard auth',
    status: hasValue(env['DASHBOARD_AUTH_TOKEN']) ? 'pass' : 'warn',
    message: hasValue(env['DASHBOARD_AUTH_TOKEN']) ? 'Configured' : 'Set DASHBOARD_AUTH_TOKEN before using dashboard outside localhost.',
  });

  checks.push({
    name: 'Message encryption key',
    status: !hasValue(env['MESSAGE_ENCRYPTION_KEY']) || env['MESSAGE_ENCRYPTION_KEY']!.length === 64 ? 'pass' : 'fail',
    message: hasValue(env['MESSAGE_ENCRYPTION_KEY']) ? 'Configured length checked' : 'Optional; required for encrypted Slack/WhatsApp stored fields.',
  });

  const agents = getAllAgents();
  const invalidAgents = agents.filter((agent) => !validateAgentId(agent.id));
  checks.push({
    name: 'Agent registry',
    status: invalidAgents.length === 0 && agents.length > 0 ? 'pass' : 'fail',
    message: invalidAgents.length > 0
      ? `Invalid ids: ${invalidAgents.map((agent) => agent.id).join(', ')}`
      : `${agents.length} agents discovered from ${agentsDir}.`,
  });

  if (env['WARROOM_ENABLED']?.toLowerCase() === 'true') {
    checks.push({
      name: 'War Room API key',
      status: hasValue(env['GOOGLE_API_KEY']) || hasValue(env['OPENAI_API_KEY']) ? 'pass' : 'warn',
      message: 'War Room is enabled; configure GOOGLE_API_KEY or OPENAI_API_KEY for the selected mode.',
    });
  }

  if (env['SLACK_ENABLED']?.toLowerCase() === 'true') {
    checks.push({
      name: 'Slack token',
      status: hasValue(env['SLACK_BOT_TOKEN']) ? 'pass' : 'fail',
      message: hasValue(env['SLACK_BOT_TOKEN']) ? 'Configured' : 'SLACK_BOT_TOKEN is required when SLACK_ENABLED=true.',
    });
  }

  return checks;
}

function printChecks(checks: DoctorCheck[]): void {
  for (const check of checks) {
    const icon = check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`${icon.padEnd(4)} ${check.name}: ${check.message}`);
  }
}

if (import.meta.url.endsWith('/doctor.js') || process.argv[1]?.endsWith('/doctor.ts')) {
  const checks = runDoctor();
  printChecks(checks);
  const hasFail = checks.some((check) => check.status === 'fail');
  process.exit(hasFail ? 1 : 0);
}
