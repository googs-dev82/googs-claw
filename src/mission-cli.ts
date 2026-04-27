#!/usr/bin/env node

import { 
  createMissionTask, 
  getMissionTasks, 
  updateMissionTask,
  MissionTask 
} from './db.js';
import { logger } from './logger.js';
import { orchestrator } from './orchestrator.js';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'list':
      listTasks();
      break;
    case 'add':
      await addTask();
      break;
    case 'run':
      await runTask();
      break;
    case 'status':
      showStatus();
      break;
    default:
      showUsage();
  }
}

function listTasks() {
  const status = args[1];
  const tasks = status ? getMissionTasks(status) : getMissionTasks();
  
  if (tasks.length === 0) {
    console.log('No mission tasks');
    return;
  }

  console.log('\nMission Tasks:\n');
  console.log('ID          | Agent ID   | Priority | Status    | Created');
  console.log('-'.repeat(70));
  
  for (const task of tasks) {
    console.log(
      `${task.id.padEnd(12)} | ${task.agent_id.padEnd(10)} | ${task.priority}       | ${task.status.padEnd(10)} | ${new Date(task.created_at).toLocaleString()}`
    );
    
    if (task.prompt.length > 50) {
      console.log(`  Prompt: ${task.prompt.slice(0, 50)}...`);
    } else if (task.prompt) {
      console.log(`  Prompt: ${task.prompt}`);
    }
  }
  console.log();
}

async function addTask() {
  const id = args[1];
  const chatId = args[2];
  const agentId = args[3] || 'main';
  const priority = parseInt(args[4] || '3', 10);
  const prompt = args.slice(5).join(' ');

  if (!id || !chatId || !prompt) {
    console.error('Usage: mission-cli.ts add <id> <chatId> [agentId] [priority] <prompt>');
    console.error('Example: mission-cli.ts add task1 123456789 main 2 "Research AI trends"');
    process.exit(1);
  }

  try {
    createMissionTask({
      id,
      chat_id: chatId,
      agent_id: agentId,
      prompt,
      priority,
      status: 'pending',
      result: null,
    });
    
    console.log(`Mission task "${id}" created successfully`);
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

async function runTask() {
  const id = args[1];
  
  if (!id) {
    console.error('Usage: mission-cli.ts run <id>');
    process.exit(1);
  }

  const tasks = getMissionTasks();
  const task = tasks.find(t => t.id === id);
  
  if (!task) {
    console.error(`Task "${id}" not found`);
    process.exit(1);
  }

  console.log(`Running mission task "${id}"...`);
  
  updateMissionTask(id, { status: 'running' });

  try {
    const result = await orchestrator.runWithContext(
      task.chat_id,
      task.prompt,
      task.agent_id,
      true
    );

    updateMissionTask(id, {
      status: 'completed',
      result: result.content,
      completed_at: Date.now(),
    });

    console.log(`\nTask completed in ${result.duration}ms`);
    console.log(`\nResult:\n${result.content}`);
  } catch (error) {
    updateMissionTask(id, {
      status: 'failed',
      result: `Error: ${error}`,
      completed_at: Date.now(),
    });
    
    console.error(`Task failed: ${error}`);
    process.exit(1);
  }
}

function showStatus() {
  const pending = getMissionTasks('pending');
  const running = getMissionTasks('running');
  const completed = getMissionTasks('completed');
  const failed = getMissionTasks('failed');
  
  console.log('\nMission Control Status:\n');
  console.log(`Pending: ${pending.length}`);
  console.log(`Running: ${running.length}`);
  console.log(`Completed: ${completed.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log();
}

function showUsage() {
  console.log(`
ClaudeClaw Mission Control CLI

Usage:
  mission-cli.ts <command> [options]

Commands:
  list [status]    List all mission tasks (optionally filtered by status)
  add <id> <chatId> [agentId] [priority] <prompt>
                    Add a new mission task
  run <id>         Run a mission task immediately
  status           Show mission control status

Status Values:
  pending, running, completed, failed

Priority:
  1 = highest, 5 = lowest (default: 3)

Examples:
  mission-cli.ts list
  mission-cli.ts list pending
  mission-cli.ts add research1 123456789 main 2 "Research latest AI news"
  mission-cli.ts run research1
  mission-cli.ts status
`);
}

main().catch(error => {
  logger.error({ error }, 'Mission CLI error');
  console.error(error);
  process.exit(1);
});
