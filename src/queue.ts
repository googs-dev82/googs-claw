import { logger } from './logger.js';

type Task<T> = () => Promise<T>;

export class ChatQueue {
  private queues = new Map<string, Task<any>[]>();
  private processing = new Set<string>();

  async enqueue<T>(chatId: string, task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const wrappedTask = async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };

      if (!this.queues.has(chatId)) {
        this.queues.set(chatId, []);
      }
      this.queues.get(chatId)!.push(wrappedTask);

      this.processQueue(chatId);
    });
  }

  private async processQueue(chatId: string) {
    if (this.processing.has(chatId)) {
      return;
    }

    this.processing.add(chatId);
    
    try {
      const queue = this.queues.get(chatId);
      while (queue && queue.length > 0) {
        const task = queue.shift();
        if (task) {
          try {
            await task();
          } catch (error) {
            logger.error({ error, chatId }, 'Error processing task in queue');
          }
        }
      }
    } finally {
      this.processing.delete(chatId);
      if (this.queues.get(chatId)?.length === 0) {
        this.queues.delete(chatId);
      }
    }
  }
}

export const globalChatQueue = new ChatQueue();
