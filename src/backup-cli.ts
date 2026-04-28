#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { basename, join } from 'path';
import { PROJECT_ROOT } from './env.js';

const args = process.argv.slice(2);
const command = args[0] || 'backup';
const backupRoot = join(PROJECT_ROOT, 'backups');
const dbPath = join(PROJECT_ROOT, 'store', 'claudeclaw.db');

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureBackupRoot(): void {
  if (!existsSync(backupRoot)) {
    mkdirSync(backupRoot, { recursive: true });
  }
}

function backup(): void {
  ensureBackupRoot();
  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }
  const target = join(backupRoot, `claudeclaw-${timestamp()}.db`);
  copyFileSync(dbPath, target);
  console.log(`Backup created: ${target}`);
}

function list(): void {
  ensureBackupRoot();
  const files = readdirSync(backupRoot).filter((file) => file.endsWith('.db')).sort();
  if (files.length === 0) {
    console.log('No backups found.');
    return;
  }
  for (const file of files) {
    console.log(file);
  }
}

function restore(): void {
  const backupName = args[1];
  if (!backupName) {
    throw new Error('Usage: npm run restore -- <backup-file-name>');
  }

  const source = join(backupRoot, basename(backupName));
  if (!existsSync(source)) {
    throw new Error(`Backup not found: ${source}`);
  }
  copyFileSync(source, dbPath);
  console.log(`Database restored from: ${source}`);
}

try {
  switch (command) {
    case 'backup':
      backup();
      break;
    case 'list':
      list();
      break;
    case 'restore':
      restore();
      break;
    default:
      throw new Error('Usage: backup-cli.ts [backup|list|restore <backup-file-name>]');
  }
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
