import { describe, expect, it } from 'vitest';
import { app } from '../src/dashboard.js';

describe('dashboard API', () => {
  it('serves health status', async () => {
    const response = await app.request('/health');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('number');
  });

  it('lists configured agents through the dashboard API', async () => {
    const response = await app.request('/api/agents');
    const agents = await response.json();

    expect(response.status).toBe(200);
    expect(agents.map((agent: { id: string }) => agent.id)).toContain('fullstack');
  });

  it('opens a server-sent event stream with a connected event', async () => {
    const response = await app.request('/api/events');
    const reader = response.body?.getReader();
    expect(response.status).toBe(200);
    expect(reader).toBeTruthy();

    const chunk = await reader!.read();
    const text = new TextDecoder().decode(chunk.value);
    await reader!.cancel();

    expect(text).toContain('event: connected');
  });
});
