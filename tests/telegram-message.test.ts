import { describe, expect, it } from 'vitest';
import { splitTelegramMessage } from '../src/bot.js';

describe('Telegram message splitting', () => {
  it('leaves short messages untouched', () => {
    expect(splitTelegramMessage('hello')).toEqual(['hello']);
  });

  it('splits long messages below Telegram limits', () => {
    const text = Array.from({ length: 500 }, (_, index) => `Paragraph ${index}: ${'x'.repeat(20)}`).join('\n\n');
    const chunks = splitTelegramMessage(text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
    expect(chunks.join('').replace(/\s+/g, ' ')).toContain('Paragraph 0');
    expect(chunks.join('').replace(/\s+/g, ' ')).toContain('Paragraph 499');
  });
});
