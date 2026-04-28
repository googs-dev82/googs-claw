import { describe, expect, it } from 'vitest';
import { runDoctor } from '../src/doctor.js';

describe('doctor checks', () => {
  it('warns when dashboard auth is not configured', () => {
    const checks = runDoctor({
      TELEGRAM_BOT_TOKEN: 'token',
      ALLOWED_TELEGRAM_IDS: '123',
      MESSAGE_ENCRYPTION_KEY: 'a'.repeat(64),
    });

    const dashboard = checks.find((check) => check.name === 'Dashboard auth');
    expect(dashboard?.status).toBe('warn');
  });

  it('fails invalid encryption key lengths', () => {
    const checks = runDoctor({
      TELEGRAM_BOT_TOKEN: 'token',
      ALLOWED_TELEGRAM_IDS: '123',
      DASHBOARD_AUTH_TOKEN: 'secret',
      MESSAGE_ENCRYPTION_KEY: 'too-short',
    });

    const encryption = checks.find((check) => check.name === 'Message encryption key');
    expect(encryption?.status).toBe('fail');
  });
});
