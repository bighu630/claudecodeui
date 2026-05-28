/**
 * OpenAI Codex SDK Integration
 * =============================
 *
 * This module provides integration with the OpenAI Codex SDK for non-interactive
 * chat sessions. It mirrors the pattern used in claude-sdk.js for consistency.
 *
 * ## Usage
 *
 * - queryCodex(command, options, ws) - Execute a prompt with streaming via WebSocket
 * - abortCodexSession(sessionId) - Cancel an active session
 * - isCodexSessionActive(sessionId) - Check if a session is running
 * - getActiveCodexSessions() - List all active sessions
 */

import { Codex } from '@openai/codex-sdk';

import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import {
  bindChildRuntimeFromTool,
  bindExternalSessionId,
  finalizeOrchestratorRun,
  handleOrchestratorToolCall,
  materializeAndBindChildSessionFromTool,
  ORCHESTRATOR_ACTION_SCHEMA,
  tryParseOrchestratorStructuredAction,
  prepareOrchestratorCommand,
} from './modules/orchestrator/index.js';
import { providerAuthService, sessionsService } from './modules/providers/index.js';
import { createNormalizedMessage } from './shared/utils.js';

const activeCodexSessions = new Map();

function logCodexOrchestrator(message, details = {}) {
  const payload = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : '';
  console.log(`[codex][orchestrator] ${message}${payload}`);
}

function mapPermissionModeToCodexOptions(permissionMode) {
  switch (permissionMode) {
    case 'acceptEdits':
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never'
      };
    case 'bypassPermissions':
      return {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never'
      };
    case 'default':
    default:
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'untrusted'
      };
  }
}

function createOrchestratorToolUseMessage(action, sessionId) {
  const toolName = action.type === 'lookup_role' ? 'orchestrator_lookup_role' : 'orchestrator_create_role';
  const toolInput = action.type === 'lookup_role'
    ? { role_type: action.role_type }
    : {
        role_type: action.role_type,
        title: action.title,
        goal: action.goal,
        ...(action.constraints ? { constraints: action.constraints } : {}),
      };

  return createNormalizedMessage({
    kind: 'tool_use',
    toolName,
    toolInput,
    toolId: `orchestrator_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    provider: 'codex',
  });
}

function createOrchestratorToolResultMessage(toolUseMessage, result, sessionId) {
  return createNormalizedMessage({
    kind: 'tool_result',
    toolId: toolUseMessage.toolId,
    toolResult: {
      content: JSON.stringify(result),
      isError: false,
      toolUseResult: result,
    },
    sessionId,
    provider: 'codex',
  });
}

function isThinkingResumeReasoningError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('reasoning_content') && message.includes('thinking mode');
}

async function runCodexTurnWithResumeFallback(params) {
  const {
    codex,
    sessionId,
    threadOptions,
    resolvedCommand,
    turnOptions,
    streamCallbacks,
    ws,
  } = params;

  const initialThread = sessionId
    ? codex.resumeThread(sessionId, threadOptions)
    : codex.startThread(threadOptions);

  try {
    return {
      thread: initialThread,
      turn: await streamCodexTurn(initialThread, resolvedCommand, turnOptions, streamCallbacks),
      retryUsed: false,
    };
  } catch (error) {
    if (!sessionId || !isThinkingResumeReasoningError(error)) {
      throw error;
    }

    console.warn(`[Codex] Resume failed for ${sessionId}; retrying with continue on the same thread.`, error);
    sendMessage(ws, createNormalizedMessage({
      kind: 'status',
      text: 'resume_retrying_continue',
      content: 'Codex resume failed for this thinking-mode thread. Retrying automatically with continue on the current session.',
      sessionId,
      provider: 'codex',
    }));

    return {
      thread: initialThread,
      turn: await streamCodexTurn(initialThread, 'continue', turnOptions, streamCallbacks),
      retryUsed: true,
    };
  }
}

export async function streamCodexTurn(thread, input, turnOptions, callbacks = {}) {
  const streamedTurn = await thread.runStreamed(input, turnOptions);
  const items = [];
  let finalResponse = '';
  let usage = null;

  for await (const event of streamedTurn.events) {
    if (event.type === 'thread.started') {
      callbacks.onThreadStarted?.(event.thread_id);
      continue;
    }

    if (event.type === 'item.completed') {
      items.push(event.item);
      if (event.item.type === 'agent_message' && typeof event.item.text === 'string') {
        finalResponse = event.item.text;
      }
      callbacks.onItemCompleted?.(event.item);
      continue;
    }

    if (event.type === 'turn.completed') {
      usage = event.usage;
      continue;
    }

    if (event.type === 'turn.failed') {
      throw event.error instanceof Error
        ? event.error
        : new Error(event.error?.message || 'Codex turn failed');
    }

    if (event.type === 'error') {
      throw new Error(event.message);
    }
  }

  return {
    items,
    finalResponse,
    usage,
  };
}

export async function queryCodex(command, options = {}, ws) {
  const {
    sessionId,
    sessionSummary,
    cwd,
    projectPath,
    model,
    permissionMode = 'default'
  } = options;

  const workingDirectory = cwd || projectPath || process.cwd();
  const { sandboxMode, approvalPolicy } = mapPermissionModeToCodexOptions(permissionMode);

  let codex;
  let thread;
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let terminalFailure = null;
  const abortController = new AbortController();

  if (options.orchestratorSessionId && capturedSessionId) {
    bindExternalSessionId(options.orchestratorSessionId, capturedSessionId);
  }

  try {
    const codexOptions = {};
    codex = new Codex(codexOptions);

    const threadOptions = {
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode,
      approvalPolicy,
      model
    };

    const registerSession = (id) => {
      if (!id) {
        return;
      }
      activeCodexSessions.set(id, {
        thread,
        codex,
        status: 'running',
        abortController,
        startedAt: new Date().toISOString()
      });
    };

    if (capturedSessionId) {
      registerSession(capturedSessionId);
    }

    const resolvedCommand = options.orchestratorSessionId
      ? prepareOrchestratorCommand(options.orchestratorSessionId, command)
      : command;
    const turnOptions = {
      signal: abortController.signal,
      ...(options.orchestratorSessionId ? { outputSchema: ORCHESTRATOR_ACTION_SCHEMA } : {}),
    };

    const streamCallbacks = {
      onThreadStarted: (threadId) => {
        if (!threadId) {
          return;
        }

        capturedSessionId = threadId;
        registerSession(capturedSessionId);

        if (options.orchestratorSessionId) {
          bindExternalSessionId(options.orchestratorSessionId, capturedSessionId);
        }

        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(capturedSessionId);
        }

        if (!sessionId && !sessionCreatedSent) {
          sessionCreatedSent = true;
          sendMessage(ws, createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'codex' }));
        }
      },
      onItemCompleted: (item) => {
        const normalizedSessionId = capturedSessionId || sessionId || null;
        if (options.orchestratorSessionId && item.type === 'agent_message') {
          return;
        }

        const normalizedMsgs = sessionsService.normalizeMessage('codex', {
          type: 'item.completed',
          item,
        }, normalizedSessionId);

        for (const msg of normalizedMsgs) {
          if (options.orchestratorSessionId && msg.kind === 'tool_use') {
            console.log("[DEBUG][codex-handler] -> materializeAndBindChildSessionFromTool toolName=" + msg.toolName + " toolId=" + msg.toolId);
            materializeAndBindChildSessionFromTool(options.orchestratorSessionId, {
              toolName: msg.toolName,
              toolInput: msg.toolInput,
              toolId: msg.toolId,
              runtimeInfo:
                msg.toolUseResult
                || item.toolUseResult
                || item.result
                || null,
            });
          }
          if (options.orchestratorSessionId && msg.kind === 'tool_result') {
            bindChildRuntimeFromTool(options.orchestratorSessionId, {
              toolId: msg.toolId,
              runtimeInfo: msg.toolUseResult,
            });
          }
          sendMessage(ws, msg);
        }
      },
    };

    const runResult = await runCodexTurnWithResumeFallback({
      codex,
      sessionId,
      threadOptions,
      resolvedCommand,
      turnOptions,
      streamCallbacks,
      ws,
    });
    thread = runResult.thread;
    const turn = runResult.turn;

    const lastUsage = turn.usage;
    const normalizedSessionId = capturedSessionId || sessionId || null;
    if (options.orchestratorSessionId) {
      const action = tryParseOrchestratorStructuredAction(turn.finalResponse);
      if (!action || action.type === 'message') {
        sendMessage(ws, createNormalizedMessage({
          kind: 'text',
          role: 'assistant',
          content: action?.message || turn.finalResponse,
          sessionId: normalizedSessionId,
          provider: 'codex',
        }));
      } else {
        const toolUseMessage = createOrchestratorToolUseMessage(action, normalizedSessionId);
        sendMessage(ws, toolUseMessage);

        const toolName = action.type === 'lookup_role' ? 'orchestrator_lookup_role' : 'orchestrator_create_role';
        const toolInput = action.type === 'lookup_role'
          ? { role_type: action.role_type }
          : {
              role_type: action.role_type,
              title: action.title,
              goal: action.goal,
              ...(action.constraints ? { constraints: action.constraints } : {}),
            };

        const toolCallResult = await handleOrchestratorToolCall(
          toolName,
          toolInput,
          options.orchestratorSessionId,
        );

        logCodexOrchestrator('structured orchestrator action executed locally', {
          actionType: action.type,
          orchestratorSessionId: options.orchestratorSessionId,
          sessionId: normalizedSessionId,
          result: toolCallResult.result,
        });

        sendMessage(ws, createOrchestratorToolResultMessage(toolUseMessage, toolCallResult.result, normalizedSessionId));
      }
    }

    if (lastUsage) {
      const totalTokens = (lastUsage.input_tokens || 0) + (lastUsage.output_tokens || 0);
      sendMessage(ws, createNormalizedMessage({
        kind: 'status',
        text: 'token_budget',
        tokenBudget: { used: totalTokens, total: 200000 },
        sessionId: capturedSessionId || sessionId || null,
        provider: 'codex',
      }));
    }

    if (!terminalFailure) {
      sendMessage(ws, createNormalizedMessage({
        kind: 'complete',
        actualSessionId: capturedSessionId || thread.id || sessionId || null,
        sessionId: capturedSessionId || sessionId || null,
        provider: 'codex'
      }));
      notifyRunStopped({
        userId: ws?.userId || null,
        provider: 'codex',
        sessionId: capturedSessionId || sessionId || null,
        sessionName: sessionSummary,
        stopReason: 'completed'
      });

      if (options.orchestratorSessionId) {
        finalizeOrchestratorRun(options.orchestratorSessionId, {
          success: true,
          runSummary: 'Run completed',
        });
      }
    }

  } catch (error) {
    logCodexOrchestrator('queryCodex failed', {
      orchestratorSessionId: options.orchestratorSessionId || null,
      sessionId: capturedSessionId || sessionId || null,
      error: error?.message || String(error),
    });
    const session = capturedSessionId ? activeCodexSessions.get(capturedSessionId) : null;
    const wasAborted =
      session?.status === 'aborted' ||
      error?.name === 'AbortError' ||
      String(error?.message || '').toLowerCase().includes('aborted');

    if (!wasAborted) {
      console.error('[Codex] Error:', error);

      if (options.orchestratorSessionId) {
        finalizeOrchestratorRun(options.orchestratorSessionId, {
          success: false,
          errorSummary: error?.message ?? 'Unknown error',
        });
      }

      const installed = await providerAuthService.isProviderInstalled('codex');
      const errorContent = !installed
        ? 'Codex CLI is not configured. Please set up authentication first.'
        : error.message;

      sendMessage(ws, createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'codex' }));
      if (!terminalFailure) {
        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: capturedSessionId || sessionId || null,
          sessionName: sessionSummary,
          error
        });
      }
    }

  } finally {
    if (capturedSessionId) {
      const session = activeCodexSessions.get(capturedSessionId);
      if (session) {
        session.status = session.status === 'aborted' ? 'aborted' : 'completed';
      }
    }
  }
}

export function abortCodexSession(sessionId) {
  const session = activeCodexSessions.get(sessionId);

  if (!session) {
    return false;
  }

  session.status = 'aborted';
  try {
    session.abortController?.abort();
  } catch (error) {
    console.warn(`[Codex] Failed to abort session ${sessionId}:`, error);
  }

  return true;
}

export function isCodexSessionActive(sessionId) {
  const session = activeCodexSessions.get(sessionId);
  return session?.status === 'running';
}

export function getActiveCodexSessions() {
  const sessions = [];

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status === 'running') {
      sessions.push({
        id,
        status: session.status,
        startedAt: session.startedAt
      });
    }
  }

  return sessions;
}

function sendMessage(ws, data) {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[Codex] Error sending message:', error);
  }
}

setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000;

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status !== 'running') {
      const startedAt = new Date(session.startedAt).getTime();
      if (now - startedAt > maxAge) {
        activeCodexSessions.delete(id);
      }
    }
  }
}, 5 * 60 * 1000);
