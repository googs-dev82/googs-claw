import { describe, expect, it } from 'vitest';
import { getAllAgents, validateAgentId } from '../src/agent-config.js';

describe('agent configuration', () => {
  it('validates production-safe agent ids', () => {
    expect(validateAgentId('main')).toBe(true);
    expect(validateAgentId('fullstack')).toBe(true);
    expect(validateAgentId('ops-agent_1')).toBe(true);

    expect(validateAgentId('1ops')).toBe(false);
    expect(validateAgentId('Ops')).toBe(false);
    expect(validateAgentId('ops agent')).toBe(false);
    expect(validateAgentId('a'.repeat(31))).toBe(false);
  });

  it('loads every aggregate agent from agents/agent.yaml', () => {
    const ids = getAllAgents().map((agent) => agent.id);

    expect(ids).toContain('main');
    expect(ids).toContain('comms');
    expect(ids).toContain('content');
    expect(ids).toContain('ops');
    expect(ids).toContain('research');
    expect(ids).toContain('fullstack');
  });
});
