/**
 * Direct Runner for NanoClaw
 * Runs the Claude Agent SDK in-process (no Docker containers) for Railway deployment.
 *
 * Replaces container-runner.ts when EXECUTION_MODE=direct.
 * The real ANTHROPIC_API_KEY is available via process.env on Railway.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { GROUPS_DIR } from './config.js';
import { ContainerInput, ContainerOutput } from './container-runner.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run the Claude Agent SDK in-process (direct execution mode).
 * This is the Railway-compatible alternative to runContainerAgent.
 */
export async function runDirectAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput> {
  const startTime = Date.now();

  const groupDir = resolveGroupFolderPath(group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  logger.info(
    {
      group: group.name,
      folder: group.folder,
      isMain: input.isMain,
      mode: 'direct',
    },
    'Running agent in direct mode',
  );

  // Set env vars for the Claude Agent SDK
  process.env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD = '1';
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '0';

  const cwd = path.join(GROUPS_DIR, input.groupFolder);
  fs.mkdirSync(cwd, { recursive: true });

  // Build prompt (same as container agent-runner)
  let prompt = input.prompt;
  if (input.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${prompt}`;
  }

  // Load global CLAUDE.md as additional system context (shared across all groups)
  const globalClaudeMdPath = path.join(GROUPS_DIR, 'global', 'CLAUDE.md');
  let globalClaudeMd: string | undefined;
  if (!input.isMain && fs.existsSync(globalClaudeMdPath)) {
    globalClaudeMd = fs.readFileSync(globalClaudeMdPath, 'utf-8');
  }

  // MCP server for IPC tools
  const mcpServerPath = path.join(
    __dirname,
    '..',
    'container',
    'agent-runner',
    'dist',
    'ipc-mcp-stdio.js',
  );

  let newSessionId: string | undefined;
  let resultCount = 0;

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd,
        resume: input.sessionId,
        systemPrompt: globalClaudeMd
          ? {
              type: 'preset' as const,
              preset: 'claude_code' as const,
              append: globalClaudeMd,
            }
          : undefined,
        allowedTools: [
          'Bash',
          'Read',
          'Write',
          'Edit',
          'Glob',
          'Grep',
          'WebSearch',
          'WebFetch',
          'Task',
          'TaskOutput',
          'TaskStop',
          'TeamCreate',
          'TeamDelete',
          'SendMessage',
          'TodoWrite',
          'ToolSearch',
          'Skill',
          'NotebookEdit',
          ...(fs.existsSync(mcpServerPath) ? ['mcp__nanoclaw__*'] : []),
        ],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: ['project'],
        ...(fs.existsSync(mcpServerPath)
          ? {
              mcpServers: {
                nanoclaw: {
                  command: 'node',
                  args: [mcpServerPath],
                  env: {
                    NANOCLAW_CHAT_JID: input.chatJid,
                    NANOCLAW_GROUP_FOLDER: input.groupFolder,
                    NANOCLAW_IS_MAIN: input.isMain ? '1' : '0',
                  },
                },
              },
            }
          : {}),
      },
    })) {
      if (message.type === 'system' && message.subtype === 'init') {
        newSessionId = message.session_id;
        logger.debug(
          { group: group.name, sessionId: newSessionId },
          'Direct agent session initialized',
        );
      }

      if (message.type === 'result') {
        resultCount++;
        const textResult =
          'result' in message ? (message as { result?: string }).result : null;

        logger.debug(
          { group: group.name, resultCount, hasText: !!textResult },
          'Direct agent result',
        );

        const output: ContainerOutput = {
          status: 'success',
          result: textResult || null,
          newSessionId,
        };

        if (onOutput) {
          await onOutput(output);
        }
      }
    }

    const duration = Date.now() - startTime;
    logger.info(
      { group: group.name, duration, resultCount, newSessionId },
      'Direct agent completed',
    );

    return {
      status: 'success',
      result: null,
      newSessionId,
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error(
      { group: group.name, duration, error: errorMessage },
      'Direct agent error',
    );

    return {
      status: 'error',
      result: null,
      newSessionId,
      error: errorMessage,
    };
  }
}
