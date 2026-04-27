#!/usr/bin/env node

import { createScheduledTask, getScheduledTasks, pauseScheduledTask, resumeScheduledTask, removeScheduledTask, getSchedulerStatus } from './scheduler.js';
import { logger } from './logger.js';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'list':
      listTasks();
      break;
    case 'add':
      addTask();
      break;
    case 'pause':
      pauseTask();
      break;
    case 'resume':
      resumeTask();
      break;
    case 'delete':
      deleteTask();
      break;
    case 'status':
      showStatus();
      break;
    default:
      showUsage();
  }
}

function listTasks() {
  const tasks = getScheduledTasks();
  
  if (tasks.length === 0) {
    console.log('No scheduled tasks');
    return;
  }

  console.log('\nScheduled Tasks:\n');
  console.log('ID          | Chat ID    | Schedule           | Status   | Next Run');
  console.log('-'.repeat(80));
  
  for (const task of tasks) {
    console.log(
      `${task.id.padEnd(12)} | ${task.chat_id.padEnd(10)} | ${task.schedule.padEnd(18)} | ${task.status.padEnd(8)} | ${new Date(task.next_run).toLocaleString()}`
    );
  }
  console.log();
}

function addTask() {
  const id = args[1];
  const chatId = args[2];
  const schedule = args[3];
  const prompt = args.slice(4).join(' ');

  if (!id || !chatId || !schedule || !prompt) {
    console.error('Usage: schedule-cli.ts add <id> <chatId> <schedule> <prompt>');
    console.error('Example: schedule-cli.ts add daily-briefing 123456789 "0 9 * * *" "Give me a daily briefing"');
    process.exit(1);
  }

  try {
    const task = createScheduledTask(id, chatId, prompt, schedule);
    console.log(`Task "${id}" created successfully`);
    console.log(`Next run: ${new Date(task.next_run).toLocaleString()}`);
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

function pauseTask() {
  const id = args[1];
  
  if (!id) {
    console.error('Usage: schedule-cli.ts pause <id>');
    process.exit(1);
  }

  try {
    pauseScheduledTask(id);
    console.log(`Task "${id}" paused`);
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

function resumeTask() {
  const id = args[1];
  
  if (!id) {
    console.error('Usage: schedule-cli.ts resume <id>');
    process.exit(1);
  }

  try {
    resumeScheduledTask(id);
    console.log(`Task "${id}" resumed`);
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

function deleteTask() {
  const id = args[1];
  
  if (!id) {
    console.error('Usage: schedule-cli.ts delete <id>');
    process.exit(1);
  }

  try {
    removeScheduledTask(id);
    console.log(`Task "${id}" deleted`);
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

function showStatus() {
  const status = getSchedulerStatus();
  
  console.log('\nScheduler Status:\n');
  console.log(`Running: ${status.running ? 'Yes' : 'No'}`);
  console.log(`Total Tasks: ${status.totalTasks}`);
  console.log(`Due Tasks: ${status.dueTasks}`);
  console.log();
}

function showUsage() {
  console.log(`
ClaudeClaw Scheduler CLI

Usage:
  schedule-cli.ts <command> [options]

Commands:
  list              List all scheduled tasks
  add <id> <chatId> <schedule> <prompt>
                    Add a new scheduled task
  pause <id>        Pause a scheduled task
  resume <id>       Resume a paused task
  delete <id>       Delete a scheduled task
  status            Show scheduler status

Schedule Format (cron):
  * * * * * (minute hour day month weekday)
  Examples:
    "0 9 * * *"     - Daily at 9:00 AM
    "0 9 * * 1-5"  - Weekdays at 9:00 AM
    "*/15 * * * *" - Every 15 minutes
    "0 0 1 * *"    - First day of every month

Examples:
  schedule-cli.ts list
  schedule-cli.ts add daily-summary 123456789 "0 9 * * *" "Give me a daily summary"
  schedule-cli.ts pause daily-summary
  schedule-cli.ts delete daily-summary
`);
}

main().catch(error => {
  logger.error({ error }, 'Schedule CLI error');
  console.error(error);
  process.exit(1);
});