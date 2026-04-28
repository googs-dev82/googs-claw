import { describe, expect, it } from 'vitest';
import { ChatQueue } from '../src/queue.js';

describe('ChatQueue', () => {
  it('serializes work for the same chat in FIFO order', async () => {
    const queue = new ChatQueue();
    const events: string[] = [];

    const first = queue.enqueue('chat-1', async () => {
      events.push('first-start');
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push('first-end');
      return 'first';
    });

    const second = queue.enqueue('chat-1', async () => {
      events.push('second-start');
      events.push('second-end');
      return 'second';
    });

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(events).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
  });

  it('allows different chats to progress independently', async () => {
    const queue = new ChatQueue();
    const events: string[] = [];

    const slow = queue.enqueue('chat-1', async () => {
      events.push('chat-1-start');
      await new Promise((resolve) => setTimeout(resolve, 25));
      events.push('chat-1-end');
    });

    const fast = queue.enqueue('chat-2', async () => {
      events.push('chat-2-run');
    });

    await Promise.all([slow, fast]);
    expect(events).toContain('chat-2-run');
    expect(events.indexOf('chat-2-run')).toBeLessThan(events.indexOf('chat-1-end'));
  });
});
