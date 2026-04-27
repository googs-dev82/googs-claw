import cronParser from 'cron-parser';
import { 
  createTask, 
  getTask, 
  getAllTasks, 
  getDueTasks, 
  updateTask, 
  deleteTask,
  ScheduledTask 
} from './db.js';
import { logger } from './logger.js';
import { readEnvFile } from './env.js';
import { orchestrator } from './orchestrator.js';

const env = readEnvFile();
const SCHEDULER_POLL_INTERVAL = parseInt(env['SCHEDULER_POLL_INTERVAL'] ?? '60000', 10); // 1 minute
const { parseExpression } = cronParser;

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/**
 * Create a scheduled task
 */
export function createScheduledTask(
  id: string,
  chatId: string,
  prompt: string,
  schedule: string,
  agentId: string = 'main',
  priority: number = 3
): ScheduledTask {
  // Validate cron expression
  try {
    parseExpression(schedule);
  } catch (error) {
    throw new Error(`Invalid cron expression: ${schedule}`);
  }

  const nextRun = getNextRunTime(schedule);
  
  const task: Omit<ScheduledTask, 'created_at'> = {
    id,
    chat_id: chatId,
    prompt,
    schedule,
    next_run: nextRun.getTime(),
    last_run: null,
    last_result: null,
    priority,
    agent_id: agentId,
    status: 'active',
  };

  createTask(task);
  logger.info({ taskId: id, chatId, schedule }, 'Scheduled task created');
  
  return { ...task, created_at: Date.now() };
}

/**
 * Calculate next run time from cron expression
 */
export function getNextRunTime(cronExpression: string): Date {
  const interval = parseExpression(cronExpression);
  return interval.next().toDate();
}

/**
 * Get all scheduled tasks
 */
export function getScheduledTasks(): ScheduledTask[] {
  return getAllTasks();
}

/**
 * Get task by ID
 */
export function getScheduledTask(id: string): ScheduledTask | undefined {
  return getTask(id);
}

/**
 * Pause a scheduled task
 */
export function pauseScheduledTask(id: string): void {
  updateTask(id, { status: 'paused' });
  logger.info({ taskId: id }, 'Scheduled task paused');
}

/**
 * Resume a scheduled task
 */
export function resumeScheduledTask(id: string): void {
  const task = getTask(id);
  if (!task) {
    throw new Error(`Task ${id} not found`);
  }

  const nextRun = getNextRunTime(task.schedule);
  updateTask(id, { 
    status: 'active',
    next_run: nextRun.getTime(),
  });
  logger.info({ taskId: id }, 'Scheduled task resumed');
}

/**
 * Delete a scheduled task
 */
export function removeScheduledTask(id: string): void {
  deleteTask(id);
  logger.info({ taskId: id }, 'Scheduled task deleted');
}

/**
 * Run a scheduled task
 */
async function runScheduledTask(task: ScheduledTask): Promise<void> {
  logger.info({ taskId: task.id, chatId: task.chat_id }, 'Running scheduled task');
  
  updateTask(task.id, { status: 'running' });

  try {
    const result = await orchestrator.runWithContext(
      task.chat_id,
      task.prompt,
      task.agent_id,
      true // include memory
    );

    updateTask(task.id, {
      status: 'active',
      last_run: Date.now(),
      last_result: result.content.slice(0, 1000),
      next_run: getNextRunTime(task.schedule).getTime(),
    });

    logger.info({ taskId: task.id, duration: result.duration }, 'Scheduled task completed');
  } catch (error) {
    logger.error({ error, taskId: task.id }, 'Scheduled task failed');
    
    updateTask(task.id, {
      status: 'failed',
      last_run: Date.now(),
      last_result: `Error: ${error}`,
      next_run: getNextRunTime(task.schedule).getTime(),
    });
  }
}

/**
 * Process due tasks
 */
async function processDueTasks(): Promise<void> {
  const dueTasks = getDueTasks();
  
  if (dueTasks.length === 0) {
    return;
  }

  logger.info({ count: dueTasks.length }, 'Processing due tasks');

  // Process tasks in parallel (up to 3 at a time)
  const batch = dueTasks.slice(0, 3);
  
  await Promise.all(
    batch.map(task => runScheduledTask(task))
  );
}

/**
 * Start the scheduler
 */
export function startScheduler(): void {
  if (isRunning) {
    logger.warn('Scheduler already running');
    return;
  }

  isRunning = true;
  logger.info({ interval: SCHEDULER_POLL_INTERVAL }, 'Starting scheduler');

  schedulerInterval = setInterval(async () => {
    try {
      await processDueTasks();
    } catch (error) {
      logger.error({ error }, 'Scheduler error');
    }
  }, SCHEDULER_POLL_INTERVAL);
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  isRunning = false;
  logger.info('Scheduler stopped');
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus(): {
  running: boolean;
  dueTasks: number;
  totalTasks: number;
} {
  const allTasks = getAllTasks();
  const dueTasks = getDueTasks();

  return {
    running: isRunning,
    dueTasks: dueTasks.length,
    totalTasks: allTasks.length,
  };
}

/**
 * Manually trigger a task
 */
export async function triggerTaskNow(id: string): Promise<void> {
  const task = getTask(id);
  if (!task) {
    throw new Error(`Task ${id} not found`);
  }

  await runScheduledTask(task);
}

/**
 * Update task schedule
 */
export function rescheduleTask(id: string, newSchedule: string): void {
  // Validate new cron expression
  try {
    parseExpression(newSchedule);
  } catch (error) {
    throw new Error(`Invalid cron expression: ${newSchedule}`);
  }

  const nextRun = getNextRunTime(newSchedule);
  updateTask(id, {
    schedule: newSchedule,
    next_run: nextRun.getTime(),
  });

  logger.info({ taskId: id, newSchedule }, 'Task rescheduled');
}

/**
 * Get next run times for all tasks
 */
export function getNextRunTimes(): Array<{ id: string; nextRun: Date }> {
  const tasks = getAllTasks();
  
  return tasks.map(task => ({
    id: task.id,
    nextRun: new Date(task.next_run),
  }));
}
