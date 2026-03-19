import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// Mock the claude-agent-sdk before importing direct-runner
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

// Mock group-folder to avoid filesystem requirements
vi.mock('./group-folder.js', () => ({
  resolveGroupFolderPath: vi.fn(
    (folder: string) => `/tmp/test-groups/${folder}`,
  ),
}));

// Mock logger
vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs operations
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: vi.fn(),
      existsSync: vi.fn(() => false),
      readFileSync: actual.readFileSync,
    },
  };
});

import { query } from '@anthropic-ai/claude-agent-sdk';
import { runDirectAgent } from './direct-runner.js';
import { ContainerInput, ContainerOutput } from './container-runner.js';
import { RegisteredGroup } from './types.js';
import { GROUPS_DIR } from './config.js';

const mockQuery = vi.mocked(query);

const testGroup: RegisteredGroup = {
  name: 'Test Group',
  folder: 'test-family',
  trigger: '@Butler',
  added_at: '2026-01-01T00:00:00Z',
};

const testInput: ContainerInput = {
  prompt: 'Hello, what is the weather?',
  groupFolder: 'test-family',
  chatJid: '1234567890@g.us',
  isMain: true,
  assistantName: 'Butler',
};

describe('direct-runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports runDirectAgent as a function', () => {
    expect(typeof runDirectAgent).toBe('function');
  });

  it('constructs the correct working directory from GROUPS_DIR + input.groupFolder', async () => {
    // Return an empty async iterable
    async function* emptyStream() {}
    mockQuery.mockReturnValue(emptyStream() as any);

    await runDirectAgent(testGroup, testInput);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options?.cwd).toBe(path.join(GROUPS_DIR, 'test-family'));
  });

  it('returns error output when agent throws', async () => {
    mockQuery.mockImplementation(() => {
      throw new Error('SDK connection failed');
    });

    const result = await runDirectAgent(testGroup, testInput);

    expect(result.status).toBe('error');
    expect(result.error).toContain('SDK connection failed');
    expect(result.result).toBeNull();
  });

  it('calls onOutput callback with ContainerOutput shape on result messages', async () => {
    async function* resultStream() {
      yield {
        type: 'system' as const,
        subtype: 'init' as const,
        session_id: 'sess-123',
      };
      yield {
        type: 'result' as const,
        subtype: 'success' as const,
        result: 'The weather is sunny.',
      };
    }
    mockQuery.mockReturnValue(resultStream() as any);

    const outputs: ContainerOutput[] = [];
    const onOutput = vi.fn(async (output: ContainerOutput) => {
      outputs.push(output);
    });

    await runDirectAgent(testGroup, testInput, onOutput);

    expect(onOutput).toHaveBeenCalledTimes(1);
    expect(outputs[0]).toEqual({
      status: 'success',
      result: 'The weather is sunny.',
      newSessionId: 'sess-123',
    });
  });

  it('passes sessionId as resume option when provided', async () => {
    async function* emptyStream() {}
    mockQuery.mockReturnValue(emptyStream() as any);

    const inputWithSession = {
      ...testInput,
      sessionId: 'existing-session-456',
    };
    await runDirectAgent(testGroup, inputWithSession);

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options?.resume).toBe('existing-session-456');
  });

  it('sets settingSources to project', async () => {
    async function* emptyStream() {}
    mockQuery.mockReturnValue(emptyStream() as any);

    await runDirectAgent(testGroup, testInput);

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options?.settingSources).toEqual(['project']);
  });

  it('prefixes scheduled task prompts', async () => {
    async function* emptyStream() {}
    mockQuery.mockReturnValue(emptyStream() as any);

    const scheduledInput = { ...testInput, isScheduledTask: true };
    await runDirectAgent(testGroup, scheduledInput);

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.prompt).toContain('[SCHEDULED TASK');
    expect(callArgs.prompt).toContain(testInput.prompt);
  });
});
