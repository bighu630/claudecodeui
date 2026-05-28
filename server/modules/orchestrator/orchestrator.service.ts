import { v4 as uuidv4 } from 'uuid';

import { orchestratorSessionsDb, projectsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

import { composePrompt, featureLeadStartupMessage, subagentStartupMessage, getRolePrompt } from './prompts.js';
import type { SessionType } from './prompts.js';

export type { SessionType };

export interface OrchestratorSession {
  id: string;
  project_id: string;
  parent_id: string | null;
  provider: string | null;
  model: string | null;
  type: SessionType;
  title: string;
  interaction_mode: 'conversational' | 'managed';
  lifecycle_status: 'active' | 'completed' | 'failed' | 'archived';
  run_status: 'idle' | 'queued' | 'running' | 'waiting_input' | 'blocked';
  runtime_session_id: string | null;
  system_prompt: string;
  role_prompt: string;
  project_knowledge_snapshot: string;
  goal_and_constraints: string;
  workspace_path: string | null;
  auto_run: number;
  summary_text: string;
  last_run_summary: string;
  last_error_summary: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface SessionTreeNode extends OrchestratorSession {
  children: SessionTreeNode[];
}

export interface WorkerTaskSpec {
  id: string;
  worker_session_id: string;
  title: string;
  objective: string;
  scope: string;
  constraints: string;
  input_context: string;
  expected_output: string;
  acceptance_criteria: string;
  created_by_session_id: string;
  created_at: string;
}

type MaterializeChildParams = {
  toolName?: string | null;
  toolInput?: unknown;
  toolId?: string | null;
};

type BindChildRuntimeParams = {
  toolId?: string | null;
  runtimeInfo?: unknown;
};

type MaterializeAndBindChildParams = MaterializeChildParams & {
  runtimeInfo?: unknown;
};

type ChildSessionAutoRunParams = {
  session: OrchestratorSession;
  startupMessage: string;
};

type ChildSessionAutoRunExecutor = (params: ChildSessionAutoRunParams) => Promise<void>;

type OrchestratorToolCallResult = {
  requires_response: true;
  result: Record<string, unknown>;
};

type RuntimeWaiter = {
  resolve: (runtimeSessionId: string | null) => void;
  timer: NodeJS.Timeout;
};

type BootstrapRootSessionType = Extract<SessionType, 'tech_lead' | 'ops'>;
type ConfigurableRoleSessionType = Exclude<SessionType, 'worker'>;

const SESSION_DEFAULTS: Record<SessionType, { interaction_mode: string; auto_run: number; run_status: string }> = {
  tech_lead: { interaction_mode: 'conversational', auto_run: 0, run_status: 'idle' },
  feature_lead: { interaction_mode: 'conversational', auto_run: 1, run_status: 'queued' },
  worker: { interaction_mode: 'managed', auto_run: 1, run_status: 'queued' },
  ops: { interaction_mode: 'conversational', auto_run: 0, run_status: 'idle' },
};

const INTERNAL_SUBAGENT_MODEL_DEFAULT = {
  provider: 'codex',
  model: 'gpt-5.4',
} as const;

const DERIVATION_RULES: Record<SessionType, SessionType[]> = {
  tech_lead: ['feature_lead'],
  feature_lead: [],
  worker: [],
  ops: [],
};

const ROOT_SESSION_GOALS: Record<BootstrapRootSessionType, { title: string; goal: string }> = {
  tech_lead: {
    title: '技术主管',
    goal: '负责当前项目的整体架构和技术选型',
  },
  ops: {
    title: '运维',
    goal: '负责运维支持、中间件接入、部署建议',
  },
};

const MATERIALIZABLE_TOOL_NAMES = new Set(['Task', 'collab_tool_call']);
let childSessionAutoRunExecutor: ChildSessionAutoRunExecutor | null = null;
const runtimeSessionWaiters = new Map<string, RuntimeWaiter[]>();

function logOrchestratorTooling(message: string, details?: Record<string, unknown>): void {
  const payload = details && Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : '';
  console.log(`[orchestrator][tooling] ${message}${payload}`);
}

export function canCreateChild(parentType: SessionType, childType: SessionType): boolean {
  return DERIVATION_RULES[parentType]?.includes(childType) ?? false;
}

function isConfigurableRoleSessionType(type: SessionType): type is ConfigurableRoleSessionType {
  return type !== 'worker';
}

function normalizeSessionTitle(title: string, fallback: string): string {
  const normalized = title.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.length > 60
    ? `${normalized.slice(0, 57).trimEnd()}...`
    : normalized;
}

function getTechLeadSession(projectId: string): OrchestratorSession | undefined {
  return orchestratorSessionsDb.getTechLeadSession(projectId);
}

function getActiveRootSession(projectId: string, type: BootstrapRootSessionType): OrchestratorSession | undefined {
  return orchestratorSessionsDb.getActiveRootSession(projectId, type);
}

function assertRootSessionUniqueness(projectId: string, type: BootstrapRootSessionType): void {
  const existing = getActiveRootSession(projectId, type);
  if (existing) {
    throw new AppError(`Project already has an active root session of type '${type}'`, {
      code: 'ORCHESTRATOR_ROOT_SESSION_EXISTS',
      statusCode: 409,
    });
  }
}

function resolveSessionParent(params: {
  projectId: string;
  type: SessionType;
  parentId: string | null;
}): string | null {
  if (params.parentId) {
    return params.parentId;
  }

  if (params.type === 'feature_lead') {
    const techLeadSession = getTechLeadSession(params.projectId);
    if (!techLeadSession) {
      throw new AppError('Tech lead session not found for project', {
        code: 'ORCHESTRATOR_TECH_LEAD_NOT_FOUND',
        statusCode: 409,
      });
    }

    return techLeadSession.id;
  }

  return null;
}

function validateSessionCreation(params: {
  projectId: string;
  type: SessionType;
  resolvedParentId: string | null;
}): void {
  if (!params.resolvedParentId) {
    if (params.type === 'worker') {
      throw new AppError('Leaf subagent sessions must be created under a parent session', {
        code: 'ORCHESTRATOR_INVALID_ROOT_WORKER',
        statusCode: 400,
      });
    }

    if (params.type === 'feature_lead') {
      throw new AppError('Feature lead sessions must be created under the project tech_lead', {
        code: 'ORCHESTRATOR_INVALID_ROOT_FEATURE_LEAD',
        statusCode: 400,
      });
    }

    assertRootSessionUniqueness(params.projectId, params.type);
    return;
  }

  if (params.type === 'tech_lead' || params.type === 'ops') {
    throw new AppError(`Root session type '${params.type}' cannot be created as a child session`, {
      code: 'ORCHESTRATOR_INVALID_CHILD_ROOT',
      statusCode: 400,
    });
  }

  const parentSession = getSession(params.resolvedParentId);
  if (!parentSession) {
    throw new AppError('Parent session not found', {
      code: 'ORCHESTRATOR_PARENT_NOT_FOUND',
      statusCode: 404,
    });
  }

  if (parentSession.project_id !== params.projectId) {
    throw new AppError('Parent session belongs to a different project', {
      code: 'ORCHESTRATOR_CROSS_PROJECT_PARENT',
      statusCode: 400,
    });
  }

  if (!canCreateChild(parentSession.type, params.type)) {
    if (params.type === 'worker') {
      return;
    }

    throw new AppError(
      `Session type '${parentSession.type}' cannot create child of type '${params.type}'`,
      {
        code: 'ORCHESTRATOR_INVALID_DERIVATION',
        statusCode: 403,
      },
    );
  }
}

function ensureRootSession(params: {
  projectId: string;
  workspacePath?: string;
  type: BootstrapRootSessionType;
}): OrchestratorSession {
  const existing = getActiveRootSession(params.projectId, params.type);
  if (existing) {
    return existing;
  }

  const rootDefaults = ROOT_SESSION_GOALS[params.type];
  return createSession({
    project_id: params.projectId,
    parent_id: null,
    type: params.type,
    title: rootDefaults.title,
    workspace_path: params.workspacePath,
    goal_and_constraints: rootDefaults.goal,
  });
}

export function createSession(params: {
  project_id: string;
  parent_id: string | null;
  provider?: string;
  model?: string;
  type: SessionType;
  title: string;
  workspace_path?: string;
  goal_and_constraints?: string;
}): OrchestratorSession {
  const id = uuidv4();
  const defaults = SESSION_DEFAULTS[params.type];
  let resolvedParentId = resolveSessionParent({
    projectId: params.project_id,
    type: params.type,
    parentId: params.parent_id,
  });
  let resolvedTitle = normalizeSessionTitle(params.title, params.type === 'feature_lead' ? '需求拆分' : params.title);

  if (params.type === 'feature_lead') {
    resolvedTitle = normalizeSessionTitle(params.title, params.goal_and_constraints || '需求拆分');
  } else if (params.type === 'worker') {
    resolvedTitle = normalizeSessionTitle(params.title, params.goal_and_constraints || '子代理任务');
  }

  validateSessionCreation({
    projectId: params.project_id,
    type: params.type,
    resolvedParentId,
  });

  const rolePrompt = params.type === 'worker' ? '' : getRolePrompt(params.type);
  const knowledgeSnapshot = getProjectKnowledge(params.project_id);
  const composedSystemPrompt = params.type === 'worker'
    ? ''
    : composePrompt(params.type, knowledgeSnapshot, params.goal_and_constraints ?? '');
  const parentSession = resolvedParentId ? getSession(resolvedParentId) : undefined;
  const projectRoleModelConfig = projectsDb.getProjectRoleModelConfig(params.project_id);
  const roleDefaults = isConfigurableRoleSessionType(params.type)
    ? projectRoleModelConfig[params.type]
    : null;
  const resolvedProvider = params.provider
    ?? roleDefaults?.provider
    ?? parentSession?.provider
    ?? INTERNAL_SUBAGENT_MODEL_DEFAULT.provider;
  const resolvedModel = params.model
    ?? roleDefaults?.model
    ?? parentSession?.model
    ?? INTERNAL_SUBAGENT_MODEL_DEFAULT.model;

  const session = orchestratorSessionsDb.createSession({
    id,
    project_id: params.project_id,
    parent_id: resolvedParentId,
    provider: resolvedProvider,
    model: resolvedModel,
    type: params.type,
    title: resolvedTitle,
    interaction_mode: defaults.interaction_mode,
    run_status: defaults.run_status,
    system_prompt: composedSystemPrompt,
    role_prompt: rolePrompt,
    project_knowledge_snapshot: knowledgeSnapshot,
    goal_and_constraints: params.goal_and_constraints ?? '',
    workspace_path: params.workspace_path ?? null,
    auto_run: defaults.auto_run,
  });

  orchestratorSessionsDb.recordSessionEvent({ sessionId: id, runId: null, eventType: 'session_created', payload: { type: params.type, parent_id: resolvedParentId } });

  if (resolvedParentId) {
    orchestratorSessionsDb.recordSessionEvent({ sessionId: resolvedParentId, runId: null, eventType: 'child_session_created', payload: { child_id: id, child_type: params.type } });
  }

  return session;
}

export function getSession(id: string): OrchestratorSession | undefined {
  return orchestratorSessionsDb.getSession(id);
}

export function getSessionByRuntimeSessionId(externalSessionId: string): OrchestratorSession | undefined {
  return orchestratorSessionsDb.getSessionByRuntimeSessionId(externalSessionId);
}

export function isSessionVisibleInTree(session: OrchestratorSession): boolean {
  return session.lifecycle_status !== 'archived';
}

function syncDescendantSessionConfig(id: string, provider: string, model: string | null): void {
  orchestratorSessionsDb.syncDescendantSessionConfig(id, provider, model);
}

export function initializeSession(id: string, provider: string, model?: string): void {
  orchestratorSessionsDb.initializeSession(id, provider, model ?? null);
  syncDescendantSessionConfig(id, provider, model ?? null);
  updateSessionStatus(id, { run_status: 'idle' });
}

export function updateSessionStatus(
  id: string,
  updates: Partial<Pick<OrchestratorSession, 'lifecycle_status' | 'run_status' | 'runtime_session_id' | 'summary_text' | 'last_run_summary' | 'last_error_summary'>>,
): void {
  orchestratorSessionsDb.updateSessionStatus(id, updates);

  if (updates.runtime_session_id !== undefined && updates.runtime_session_id !== null) {
    resolveRuntimeSessionWaiters(id, updates.runtime_session_id);
  }
}

function resolveRuntimeSessionWaiters(sessionId: string, runtimeSessionId: string | null): void {
  const waiters = runtimeSessionWaiters.get(sessionId);
  if (!waiters || waiters.length === 0) {
    return;
  }

  runtimeSessionWaiters.delete(sessionId);
  for (const waiter of waiters) {
    clearTimeout(waiter.timer);
    waiter.resolve(runtimeSessionId);
  }
}

async function waitForRuntimeSessionId(sessionId: string, timeoutMs: number = 10_000): Promise<string | null> {
  const existing = getSession(sessionId);
  if (existing?.runtime_session_id) {
    return existing.runtime_session_id;
  }

  return await new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      const waiters = runtimeSessionWaiters.get(sessionId) ?? [];
      const remaining = waiters.filter((candidate) => candidate.timer !== timer);
      if (remaining.length === 0) {
        runtimeSessionWaiters.delete(sessionId);
      } else {
        runtimeSessionWaiters.set(sessionId, remaining);
      }
      resolve(null);
    }, timeoutMs);

    const waiter: RuntimeWaiter = {
      resolve,
      timer,
    };
    const waiters = runtimeSessionWaiters.get(sessionId) ?? [];
    waiters.push(waiter);
    runtimeSessionWaiters.set(sessionId, waiters);
  });
}

class SilentSessionWriter {
  sessionId: string | null = null;
  userId: string | number | null = null;
  isWebSocketWriter = true;

  send(_data: unknown): void {
    // Child auto-run does not require a live UI transport.
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }
}

export function archiveWorker(id: string): void {
  const session = getSession(id);
  if (!session || session.type !== 'worker') return;
  if (session.lifecycle_status !== 'completed') return;

  orchestratorSessionsDb.archiveWorker(id);
}

export function getSessionTree(project_id: string): SessionTreeNode[] {
  const rows = orchestratorSessionsDb.getAllSessionsForProject(project_id);
  return buildTree(rows.filter(isSessionVisibleInTree));
}

const SESSION_TYPE_ORDER: Record<SessionType, number> = {
  tech_lead: 0,
  feature_lead: 1,
  ops: 2,
  worker: 3,
};

function compareTreeNodes(a: OrchestratorSession, b: OrchestratorSession): number {
  const typeDiff = (SESSION_TYPE_ORDER[a.type] ?? Number.MAX_SAFE_INTEGER) - (SESSION_TYPE_ORDER[b.type] ?? Number.MAX_SAFE_INTEGER);
  if (typeDiff !== 0) {
    return typeDiff;
  }
  // Running sessions first
  const aRunning = a.run_status === 'running' ? 0 : 1;
  const bRunning = b.run_status === 'running' ? 0 : 1;
  if (aRunning !== bRunning) return aRunning - bRunning;

  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
}

function buildTree(rows: OrchestratorSession[]): SessionTreeNode[] {
  const nodeMap = new Map<string, SessionTreeNode>();
  const roots: SessionTreeNode[] = [];

  for (const row of rows) {
    nodeMap.set(row.id, {
      ...row,
      children: [],
    });
  }

  for (const row of rows) {
    const node = nodeMap.get(row.id);
    if (!node) {
      continue;
    }

    const parent = row.parent_id ? nodeMap.get(row.parent_id) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRecursively = (nodes: SessionTreeNode[]) => {
    nodes.sort(compareTreeNodes);
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortRecursively(node.children);
      }
    }
  };

  sortRecursively(roots);
  return roots;
}

export function getProjectKnowledge(project_id: string): string {
  return orchestratorSessionsDb.getProjectKnowledge(project_id);
}

export function ensureProjectKnowledge(project_id: string, initialContent: string = ''): void {
  orchestratorSessionsDb.ensureProjectKnowledge(project_id, initialContent);
}

export function ensureProjectOrchestratorBootstrap(params: {
  projectId: string;
  workspacePath?: string;
}): { techLead: OrchestratorSession; ops: OrchestratorSession } {
  ensureProjectKnowledge(params.projectId, '');

  return {
    techLead: ensureRootSession({
      projectId: params.projectId,
      workspacePath: params.workspacePath,
      type: 'tech_lead',
    }),
    ops: ensureRootSession({
      projectId: params.projectId,
      workspacePath: params.workspacePath,
      type: 'ops',
    }),
  };
}

export function createTaskSpec(params: Omit<WorkerTaskSpec, 'id' | 'created_at'>): WorkerTaskSpec {
  return orchestratorSessionsDb.createTaskSpec(params);
}

export function getTaskSpec(worker_session_id: string): WorkerTaskSpec | undefined {
  return orchestratorSessionsDb.getTaskSpec(worker_session_id);
}

export function getTaskSpecsByCreator(created_by_session_id: string): WorkerTaskSpec[] {
  return orchestratorSessionsDb.getTasksByParentSessionId(created_by_session_id);
}

export function onWorkerCompleted(workerSessionId: string, success: boolean, runSummary: string, errorSummary?: string): void {
  const worker = getSession(workerSessionId);
  if (!worker || worker.type !== 'worker') return;

  updateSessionStatus(workerSessionId, {
    lifecycle_status: success ? 'completed' : 'failed',
    run_status: 'idle',
    last_run_summary: runSummary,
    last_error_summary: errorSummary ?? '',
  });

  if (worker.parent_id) {
    const summary = `子代理完成摘要
子代理: ${worker.title}
结果状态: ${success ? '成功' : '失败'}
运行摘要: ${runSummary}
${errorSummary ? `失败摘要: ${errorSummary}` : ''}`;

    const parent = getSession(worker.parent_id);
    if (parent) {
      const newSummary = parent.last_run_summary
        ? `${parent.last_run_summary}\n\n${summary}`
        : summary;
      updateSessionStatus(worker.parent_id, { last_run_summary: newSummary });
    }
  }
}

export function getWorkerStartupContext(workerSessionId: string): string {
  const spec = getTaskSpec(workerSessionId);
  if (!spec) return '';
  return subagentStartupMessage(spec);
}

export const ORCHESTRATOR_BOOTSTRAP_OPEN_TAG = '<orchestrator_bootstrap>';
export const ORCHESTRATOR_BOOTSTRAP_CLOSE_TAG = '</orchestrator_bootstrap>';
export const ORCHESTRATOR_USER_MESSAGE_OPEN_TAG = '<orchestrator_user_message>';
export const ORCHESTRATOR_USER_MESSAGE_CLOSE_TAG = '</orchestrator_user_message>';

function extractTaggedSection(content: string, openTag: string, closeTag: string): string | null {
  const startIndex = content.indexOf(openTag);
  if (startIndex < 0) {
    return null;
  }

  const contentStart = startIndex + openTag.length;
  const endIndex = content.indexOf(closeTag, contentStart);
  if (endIndex < 0) {
    return null;
  }

  return content.slice(contentStart, endIndex);
}

export function buildOrchestratorBootstrapPrompt(
  session: OrchestratorSession,
  userCommand: string,
  startupContext: string = '',
): string {
  // Put the task payload first so child sessions surface the actual work before background constraints.
  const bootstrapSections: string[] = [];
  if (startupContext) {
    bootstrapSections.push(startupContext);
  }
  if (session.system_prompt) {
    bootstrapSections.push(session.system_prompt);
  }

  return [
    ORCHESTRATOR_BOOTSTRAP_OPEN_TAG,
    bootstrapSections.join('\n\n'),
    ORCHESTRATOR_BOOTSTRAP_CLOSE_TAG,
    ORCHESTRATOR_USER_MESSAGE_OPEN_TAG,
    userCommand,
    ORCHESTRATOR_USER_MESSAGE_CLOSE_TAG,
  ].join('\n');
}

export function buildSessionStartupMessage(session: OrchestratorSession): string {
  if (session.type === 'worker') {
    return getWorkerStartupContext(session.id) || session.goal_and_constraints || '';
  }

  return featureLeadStartupMessage(session.goal_and_constraints || '请承接上级下发目标。', '');
}

export function buildSessionInitialCommand(session: OrchestratorSession): string {
  const startupMessage = buildSessionStartupMessage(session);
  return buildOrchestratorBootstrapPrompt(session, '', startupMessage);
}

export function prepareOrchestratorCommand(orchestratorSessionId: string, userCommand: string): string {
  const session = getSession(orchestratorSessionId);
  if (!session) {
    return userCommand;
  }

  updateSessionStatus(orchestratorSessionId, {
    run_status: 'running',
    lifecycle_status: session.lifecycle_status === 'archived' ? 'active' : session.lifecycle_status,
  });

  const needsBootstrapPrompt = !session.runtime_session_id;
  const isPrecomposedBootstrap = userCommand.includes(ORCHESTRATOR_BOOTSTRAP_OPEN_TAG)
    && userCommand.includes(ORCHESTRATOR_BOOTSTRAP_CLOSE_TAG)
    && userCommand.includes(ORCHESTRATOR_USER_MESSAGE_OPEN_TAG)
    && userCommand.includes(ORCHESTRATOR_USER_MESSAGE_CLOSE_TAG);
  if (!needsBootstrapPrompt || isPrecomposedBootstrap) {
    return userCommand;
  }

  const workerStartupContext = session.type === 'worker'
    ? getWorkerStartupContext(orchestratorSessionId)
    : '';

  return buildOrchestratorBootstrapPrompt(session, userCommand, workerStartupContext);
}

export function extractVisibleOrchestratorUserMessage(content: string): string | null {
  if (!content.includes(ORCHESTRATOR_BOOTSTRAP_OPEN_TAG) && !content.includes(ORCHESTRATOR_USER_MESSAGE_OPEN_TAG)) {
    return null;
  }

  const extracted = extractTaggedSection(
    content,
    ORCHESTRATOR_USER_MESSAGE_OPEN_TAG,
    ORCHESTRATOR_USER_MESSAGE_CLOSE_TAG,
  );

  return extracted === null ? '' : extracted.trim();
}

export function finalizeOrchestratorRun(
  sessionId: string,
  params: {
    success: boolean;
    runSummary?: string;
    errorSummary?: string;
  },
): void {
  const session = getSession(sessionId);
  if (!session) {
    return;
  }

  const runSummary = params.runSummary ?? '';
  const errorSummary = params.errorSummary ?? '';

  if (session.type === 'worker') {
    onWorkerCompleted(sessionId, params.success, runSummary, errorSummary || undefined);
    return;
  }

  updateSessionStatus(sessionId, {
    lifecycle_status: params.success ? 'active' : 'failed',
    run_status: 'idle',
    last_run_summary: runSummary,
    last_error_summary: errorSummary,
  });
}

export function getSessionEvents(sessionId: string, limit: number = 50): Array<{ id: string; event_type: string; payload_json: string; created_at: string }> {
  return orchestratorSessionsDb.getSessionEvents(sessionId, limit);
}

export function bindExternalSessionId(localSessionId: string, externalSessionId: string): void {
  updateSessionStatus(localSessionId, { runtime_session_id: externalSessionId });
}

export function registerChildSessionAutoRunExecutor(executor: ChildSessionAutoRunExecutor | null): void {
  childSessionAutoRunExecutor = executor;
}

async function autoRunSessionUntilRuntimeReady(sessionId: string, timeoutMs: number = 10_000): Promise<string | null> {
  const session = getSession(sessionId);
  if (!session || session.auto_run !== 1) {
    return null;
  }

  queueChildSessionAutoRun(sessionId);
  return await waitForRuntimeSessionId(sessionId, timeoutMs);
}

export async function handleOrchestratorToolCall(
  toolName: string,
  input: unknown,
  parentSessionId: string,
): Promise<OrchestratorToolCallResult> {
  logOrchestratorTooling('handleOrchestratorToolCall start', {
    toolName,
    parentSessionId,
  });
  const parentSession = getSession(parentSessionId);
  if (!parentSession) {
    logOrchestratorTooling('parent session missing', {
      toolName,
      parentSessionId,
    });
    throw new AppError('Parent session not found', {
      code: 'ORCHESTRATOR_PARENT_NOT_FOUND',
      statusCode: 404,
    });
  }

  const normalized = readToolInputRecord(input) ?? {};

  if (toolName === 'orchestrator_lookup_role') {
    const roleType = typeof normalized.role_type === 'string' ? normalized.role_type.trim() : '';
    logOrchestratorTooling('lookup_role request', {
      parentSessionId,
      parentType: parentSession.type,
      roleType,
    });
    if (roleType !== 'tech_lead' && roleType !== 'feature_lead' && roleType !== 'ops') {
      throw new AppError(`Unsupported role_type '${roleType || 'unknown'}'`, {
        code: 'ORCHESTRATOR_INVALID_ROLE_TYPE',
        statusCode: 400,
      });
    }

    return {
      requires_response: true,
      result: {
        role_type: roleType,
        prompt: getRolePrompt(roleType),
      },
    };
  }

  if (toolName === 'orchestrator_create_role') {
    const roleType = typeof normalized.role_type === 'string' ? normalized.role_type.trim() : '';
    logOrchestratorTooling('create_role request', {
      parentSessionId,
      parentType: parentSession.type,
      parentProjectId: parentSession.project_id,
      roleType,
      hasTitle: typeof normalized.title === 'string' && normalized.title.trim().length > 0,
      hasGoal: typeof normalized.goal === 'string' && normalized.goal.trim().length > 0,
      hasConstraints: typeof normalized.constraints === 'string' && normalized.constraints.trim().length > 0,
    });
    if (roleType !== 'feature_lead') {
      throw new AppError(`Unsupported role_type '${roleType || 'unknown'}'`, {
        code: 'ORCHESTRATOR_INVALID_ROLE_TYPE',
        statusCode: 400,
      });
    }

    const title = typeof normalized.title === 'string' ? normalized.title.trim() : '';
    const goal = typeof normalized.goal === 'string' ? normalized.goal.trim() : '';
    const constraints = typeof normalized.constraints === 'string' ? normalized.constraints.trim() : '';

    if (!title) {
      throw new AppError('title is required', {
        code: 'ORCHESTRATOR_MISSING_TITLE',
        statusCode: 400,
      });
    }
    if (!goal) {
      throw new AppError('goal is required', {
        code: 'ORCHESTRATOR_MISSING_GOAL',
        statusCode: 400,
      });
    }
    if (!canCreateChild(parentSession.type, roleType)) {
      logOrchestratorTooling('create_role rejected by derivation rules', {
        parentSessionId,
        parentType: parentSession.type,
        roleType,
      });
      throw new AppError(
        `Session type '${parentSession.type}' cannot create child of type '${roleType}'`,
        {
          code: 'ORCHESTRATOR_INVALID_DERIVATION',
          statusCode: 403,
        },
      );
    }

    const combinedGoal = constraints
      ? `目标：${goal}\n\n约束：${constraints}`
      : goal;

    const session = createSession({
      project_id: parentSession.project_id,
      parent_id: parentSession.id,
      type: roleType,
      title,
      workspace_path: parentSession.workspace_path ?? undefined,
      goal_and_constraints: combinedGoal,
    });
    logOrchestratorTooling('create_role session created', {
      parentSessionId,
      childSessionId: session.id,
      childType: session.type,
      provider: session.provider,
      model: session.model,
      autoRun: session.auto_run,
    });

    const runtimeSessionId = await autoRunSessionUntilRuntimeReady(session.id, 10_000);
    if (!runtimeSessionId) {
      logOrchestratorTooling('create_role auto-run timed out', {
        parentSessionId,
        childSessionId: session.id,
      });
      return {
        requires_response: true,
        result: {
          session_id: session.id,
          role_type: roleType,
          title: session.title,
          status: 'timeout',
        },
      };
    }

    logOrchestratorTooling('create_role auto-run bound runtime session', {
      parentSessionId,
      childSessionId: session.id,
      runtimeSessionId,
    });
    return {
      requires_response: true,
      result: {
        session_id: session.id,
        role_type: roleType,
        title: session.title,
        runtime_session_id: runtimeSessionId,
      },
    };
  }

  logOrchestratorTooling('unsupported tool requested', {
    toolName,
    parentSessionId,
  });
  throw new AppError(`Unsupported orchestrator tool '${toolName}'`, {
    code: 'ORCHESTRATOR_UNSUPPORTED_TOOL',
    statusCode: 400,
  });
}

function readToolInputRecord(toolInput: unknown): Record<string, unknown> | null {
  if (!toolInput) {
    return null;
  }

  if (typeof toolInput === 'string') {
    try {
      const parsed = JSON.parse(toolInput) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { prompt: toolInput };
    }

    return { prompt: toolInput };
  }

  if (typeof toolInput === 'object' && !Array.isArray(toolInput)) {
    return toolInput as Record<string, unknown>;
  }

  return null;
}

function getToolNameVariants(toolName: string | null | undefined): string[] {
  if (typeof toolName !== 'string') {
    return [];
  }

  const trimmed = toolName.trim();
  if (!trimmed) {
    return [];
  }

  const variants = new Set<string>([trimmed]);
  const dotSegment = trimmed.split('.').pop();
  const slashSegment = trimmed.split('/').pop();
  const colonSegment = trimmed.split(':').pop();

  for (const variant of [dotSegment, slashSegment, colonSegment]) {
    if (typeof variant === 'string' && variant.trim()) {
      variants.add(variant.trim());
    }
  }

  return [...variants];
}

function isSpawnAgentToolName(toolName: string | null | undefined): boolean {
  return getToolNameVariants(toolName).includes('spawn_agent');
}

function deriveChildSessionType(parentType: SessionType): SessionType | null {
  if (parentType === 'tech_lead') {
    return 'feature_lead';
  }
  return null;
}

function isMaterializableTool(toolName: string | null | undefined, toolInput: unknown): boolean {
  if (isSpawnAgentToolName(toolName)) {
    return true;
  }

  if (getToolNameVariants(toolName).some((variant) => MATERIALIZABLE_TOOL_NAMES.has(variant))) {
    return true;
  }

  const input = readToolInputRecord(toolInput);
  if (!input) {
    return false;
  }

  const explicitRole = [
    input.subagent_type,
    input.session_role,
    input.role,
    input.orchestrator_role,
  ].find((candidate) => typeof candidate === 'string' && candidate.trim());

  if (typeof explicitRole === "string") { console.log("[DEBUG][orchestrator] isMaterializableTool=true via input." + explicitRole + " for toolName:", toolName); }
  return typeof explicitRole === 'string';
}

function deriveGoalAndConstraints(input: Record<string, unknown>): string {
  const candidates = [
    input.prompt,
    input.message,
    input.objective,
    input.description,
    input.title,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '待补充目标';
}

function deriveChildTitle(childType: SessionType, input: Record<string, unknown>): string {
  const preferred = [
    input.description,
    input.title,
    input.objective,
    input.message,
    input.prompt,
  ];

  for (const candidate of preferred) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const firstLine = candidate
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean);

    if (firstLine) {
      return normalizeSessionTitle(firstLine, childType === 'feature_lead' ? '需求拆分' : '执行任务');
    }
  }

  return childType === 'feature_lead' ? '需求拆分' : '执行任务';
}

function deriveExplicitProvider(input: Record<string, unknown>): string | undefined {
  const candidate = [
    input.provider,
    input.model_provider,
  ].find((value) => typeof value === 'string' && value.trim());

  if (typeof candidate !== 'string') {
    return undefined;
  }

  return candidate.trim();
}

function deriveExplicitModel(input: Record<string, unknown>): string | undefined {
  const candidate = [
    input.model,
    input.model_name,
  ].find((value) => typeof value === 'string' && value.trim());

  if (typeof candidate !== 'string') {
    return undefined;
  }

  return candidate.trim();
}

function shouldCreateRoleSession(
  parentSession: OrchestratorSession,
  toolName: string | null | undefined,
  input: Record<string, unknown>,
): boolean {
  const explicitRole = [
    input.session_role,
    input.orchestrator_role,
    input.role,
  ].find((candidate) => typeof candidate === 'string' && candidate.trim());

  if (parentSession.type === 'tech_lead' && typeof explicitRole === 'string' && explicitRole.trim() === 'feature_lead') {
    return true;
  }

  return parentSession.type === 'tech_lead' && getToolNameVariants(toolName).some((variant) => variant === 'Task');
}

type MaterializedChildLookup = {
  child: OrchestratorSession;
  sourceToolName: string | null;
};

function findMaterializedChildSessionLookup(
  parentSessionId: string,
  sourceToolId: string,
): MaterializedChildLookup | undefined {
  const rows = orchestratorSessionsDb.getToolCallPayloadsByParentSessionId(parentSessionId);

  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      if (payload.source_tool_id !== sourceToolId) {
        continue;
      }

      const childId = typeof payload.child_id === 'string' ? payload.child_id : '';
      if (!childId) {
        continue;
      }

      const child = getSession(childId);
      if (child) {
        return {
          child,
          sourceToolName: typeof payload.source_tool_name === 'string' ? payload.source_tool_name : null,
        };
      }
    } catch {
      // Ignore malformed payloads from unrelated events.
    }
  }

  return undefined;
}

function findMaterializedChildSession(parentSessionId: string, sourceToolId: string): OrchestratorSession | undefined {
  return findMaterializedChildSessionLookup(parentSessionId, sourceToolId)?.child;
}

function extractRuntimeSessionId(
  runtimeInfo: unknown,
  options: {
    allowGenericId?: boolean;
  } = {},
): string | null {
  if (!runtimeInfo) {
    return null;
  }

  if (typeof runtimeInfo === 'string' && runtimeInfo.trim()) {
    const trimmed = runtimeInfo.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return extractRuntimeSessionId(JSON.parse(trimmed));
      } catch {
        // Fall through to treat plain strings as direct runtime ids.
      }
    }
    return trimmed;
  }

  if (typeof runtimeInfo !== 'object' || Array.isArray(runtimeInfo)) {
    return null;
  }

  const record = runtimeInfo as Record<string, unknown>;
  const candidates = [
    record.sessionId,
    record.session_id,
    record.runtime_session_id,
    record.threadId,
    record.thread_id,
    record.agentId,
    record.agent_id,
  ];

  if (options.allowGenericId) {
    candidates.push(record.id);
  }

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }

  return null;
}

async function defaultChildSessionAutoRunExecutor(params: ChildSessionAutoRunParams): Promise<void> {
  const { session, startupMessage } = params;
  const workingDirectory = session.workspace_path || process.cwd();
  const writer = new SilentSessionWriter();
  const commonOptions = {
    cwd: workingDirectory,
    projectPath: workingDirectory,
    sessionId: session.runtime_session_id ?? undefined,
    resume: Boolean(session.runtime_session_id),
    model: session.model ?? undefined,
    sessionSummary: session.title,
    orchestratorSessionId: session.id,
  };

  switch (session.provider) {
    case 'claude': {
      const { queryClaudeSDK } = await import('../../claude-sdk.js');
      await queryClaudeSDK(startupMessage, {
        ...commonOptions,
        toolsSettings: {
          allowedTools: [],
          disallowedTools: [],
          skipPermissions: true,
        },
        permissionMode: 'bypassPermissions',
      }, writer);
      return;
    }
    case 'cursor': {
      const { spawnCursor } = await import('../../cursor-cli.js');
      await spawnCursor(startupMessage, {
        ...commonOptions,
        skipPermissions: true,
        toolsSettings: {
          allowedShellCommands: [],
          skipPermissions: true,
        },
      }, writer);
      return;
    }
    case 'codex': {
      const { queryCodex } = await import('../../openai-codex.js');
      await queryCodex(startupMessage, {
        ...commonOptions,
        permissionMode: 'acceptEdits',
      }, writer);
      return;
    }
    case 'gemini': {
      const { spawnGemini } = await import('../../gemini-cli.js');
      await spawnGemini(startupMessage, {
        ...commonOptions,
        permissionMode: 'yolo',
        toolsSettings: {
          allowedTools: [],
          disallowedTools: [],
          skipPermissions: true,
        },
      }, writer);
      return;
    }
    default:
      throw new AppError(`Unsupported provider '${session.provider ?? 'unknown'}' for child auto-run`, {
        code: 'ORCHESTRATOR_CHILD_AUTORUN_PROVIDER_UNSUPPORTED',
        statusCode: 400,
      });
  }
}

export async function autoRunSession(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session || session.auto_run !== 1) {
    return;
  }

  if (!session.provider) {
    throw new AppError('Child session provider is not configured', {
      code: 'ORCHESTRATOR_CHILD_AUTORUN_PROVIDER_MISSING',
      statusCode: 409,
    });
  }

  const executor = childSessionAutoRunExecutor ?? defaultChildSessionAutoRunExecutor;
  const initialCommand = buildSessionInitialCommand(session);
  await executor({
    session,
    startupMessage: initialCommand,
  });
}

function queueChildSessionAutoRun(sessionId: string): void {
  void autoRunSession(sessionId).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    finalizeOrchestratorRun(sessionId, {
      success: false,
      errorSummary: message,
    });
  });
}

export function materializeChildSessionFromTool(
  parentSessionId: string,
  params: MaterializeChildParams,
): OrchestratorSession | null {
  const parentSession = getSession(parentSessionId);
  if (!parentSession) {
    return null;
  }

  if (!isMaterializableTool(params.toolName, params.toolInput)) {
    return null;
  }

  const input = readToolInputRecord(params.toolInput);
  if (!input) {
    return null;
  }

  const sourceToolId = typeof params.toolId === 'string' && params.toolId.trim()
    ? params.toolId.trim()
    : null;
  if (!sourceToolId) {
    console.log("[DEBUG][orchestrator] SKIP: no sourceToolId for toolName=" + params.toolName);
    return null;
  }

  const existing = findMaterializedChildSession(parentSessionId, sourceToolId);
  if (existing) {
    console.log("[DEBUG][orchestrator] DEDUP hit: reusing existing child session for toolId=" + sourceToolId + " existingId=" + existing.id);
    return existing;
  }

  const goalAndConstraints = deriveGoalAndConstraints(input);

  if (goalAndConstraints === '待补充目标') {
    return null;
  }
  const childType = shouldCreateRoleSession(parentSession, params.toolName, input)
    ? 'feature_lead'
    : 'worker';
  const title = deriveChildTitle(childType, input);
  const explicitProvider = deriveExplicitProvider(input);
  const explicitModel = deriveExplicitModel(input);

  console.log("[DEBUG][orchestrator] CREATING child session: parentId=" + parentSession.id + " childType=" + childType + " toolName=" + params.toolName + " toolId=" + params.toolId);
  const session = createSession({
    project_id: parentSession.project_id,
    parent_id: parentSession.id,
    provider: explicitProvider,
    model: explicitModel,
    type: childType,
    title,
    workspace_path: parentSession.workspace_path ?? undefined,
    goal_and_constraints: goalAndConstraints,
  });

  orchestratorSessionsDb.recordChildSessionCreated(parentSession.id, {
    child_id: session.id,
    child_type: childType,
    source_tool_id: sourceToolId,
    source_tool_name: params.toolName ?? null,
    startup_prompt: goalAndConstraints,
  });

  if (childType === 'worker') {
    const scope = typeof input.scope === 'string' && input.scope.trim()
      ? input.scope.trim()
      : '仅执行当前子任务，不扩展范围。';
    const constraints = typeof input.constraints === 'string' && input.constraints.trim()
      ? input.constraints.trim()
      : '严格遵守 feature_lead 下发任务，不与用户自由对话。';
    const expectedOutput = typeof input.expected_output === 'string' && input.expected_output.trim()
      ? input.expected_output.trim()
      : '提交完成结果、验证情况和剩余问题。';
    const acceptance = typeof input.acceptance_criteria === 'string' && input.acceptance_criteria.trim()
      ? input.acceptance_criteria.trim()
      : '结果可验收，未完成时明确阻塞原因。';

    createTaskSpec({
      worker_session_id: session.id,
      title,
      objective: goalAndConstraints,
      scope,
      constraints,
      input_context: typeof input.input_context === 'string' && input.input_context.trim()
        ? input.input_context.trim()
        : goalAndConstraints,
      expected_output: expectedOutput,
      acceptance_criteria: acceptance,
      created_by_session_id: parentSession.id,
    });
  }

  return session;
}

export function materializeAndBindChildSessionFromTool(
  parentSessionId: string,
  params: MaterializeAndBindChildParams,
): OrchestratorSession | null {
  const session = materializeChildSessionFromTool(parentSessionId, params);
  if (!session) {
    return null;
  }

  const sourceToolId = typeof params.toolId === 'string' && params.toolId.trim()
    ? params.toolId.trim()
    : null;
  if (!sourceToolId || params.runtimeInfo === undefined || params.runtimeInfo === null) {
  console.log('[DEBUG][orchestrator] materializeAndBind: sessionId=%s runtimeInfo=%s runtime_session_id=%s',
    session.id,
    params.runtimeInfo === undefined ? 'UNDEFINED' : params.runtimeInfo === null ? 'NULL' : 'PRESENT',
    session.runtime_session_id || 'null');
    if (!session.runtime_session_id) {
      queueChildSessionAutoRun(session.id);
    }
    return session;
  }

  const bound = bindChildRuntimeFromTool(parentSessionId, {
    toolId: sourceToolId,
    runtimeInfo: params.runtimeInfo,
  }) ?? getSession(session.id) ?? session;

  if (!bound.runtime_session_id) {
      queueChildSessionAutoRun(bound.id);
  }

  return bound;
}
export function bindChildRuntimeFromTool(
  parentSessionId: string,
  params: BindChildRuntimeParams,
): OrchestratorSession | null {
  const sourceToolId = typeof params.toolId === 'string' && params.toolId.trim()
    ? params.toolId.trim()
    : null;
  if (!sourceToolId) {
    console.log("[DEBUG][orchestrator] SKIP: no sourceToolId for toolName=" + "bindChildRuntimeFromTool");
    return null;
  }

  const materializedChild = findMaterializedChildSessionLookup(parentSessionId, sourceToolId);
  if (!materializedChild) {
    console.log('[DEBUG][orchestrator] bindChildRuntime: NO materialized child found for sourceToolId=%s', sourceToolId);
    return null;
  }

  const runtimeSessionId = extractRuntimeSessionId(params.runtimeInfo, {
    allowGenericId: isSpawnAgentToolName(materializedChild.sourceToolName),
  });
  if (!runtimeSessionId) {
    return null;
  }

  const child = materializedChild.child;

  if (child.runtime_session_id === runtimeSessionId) {
    return child;
  }

  updateSessionStatus(child.id, {
    runtime_session_id: runtimeSessionId,
    run_status: 'running',
    lifecycle_status: 'active',
  });
  console.log('[DEBUG][orchestrator] bindChildRuntime: BOUND child.id=%s runtime_session_id=%s', child.id, runtimeSessionId);

  orchestratorSessionsDb.recordRuntimeBindEvent(child.id, {
    runtime_session_id: runtimeSessionId,
    bound_from_parent_tool: true,
    parent_session_id: parentSessionId,
    source_tool_id: sourceToolId,
  });

  return getSession(child.id) ?? child;
}
