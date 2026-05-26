import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

import { getConnection, projectsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

import { composePrompt, featureLeadStartupMessage, workerStartupMessage, getRolePrompt } from './prompts.js';
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
  external_session_id: string | null;
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

type BootstrapRootSessionType = Extract<SessionType, 'tech_lead' | 'ops'>;

const SESSION_DEFAULTS: Record<SessionType, { interaction_mode: string; auto_run: number; run_status: string }> = {
  tech_lead: { interaction_mode: 'conversational', auto_run: 0, run_status: 'idle' },
  feature_lead: { interaction_mode: 'conversational', auto_run: 1, run_status: 'queued' },
  worker: { interaction_mode: 'managed', auto_run: 1, run_status: 'queued' },
  ops: { interaction_mode: 'conversational', auto_run: 0, run_status: 'idle' },
};

const DERIVATION_RULES: Record<SessionType, SessionType[]> = {
  tech_lead: ['feature_lead'],
  feature_lead: ['worker'],
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

const MATERIALIZABLE_TOOL_NAMES = new Set(['Task', 'spawn_agent', 'collab_tool_call']);
let childSessionAutoRunExecutor: ChildSessionAutoRunExecutor | null = null;

export function canCreateChild(parentType: SessionType, childType: SessionType): boolean {
  return DERIVATION_RULES[parentType]?.includes(childType) ?? false;
}

function getDb(): Database.Database {
  return getConnection();
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
  const db = getDb();
  return db.prepare(
    "SELECT * FROM orchestrator_sessions WHERE project_id = ? AND type = 'tech_lead' AND lifecycle_status != 'archived' ORDER BY created_at ASC LIMIT 1"
  ).get(projectId) as OrchestratorSession | undefined;
}

function getActiveRootSession(projectId: string, type: BootstrapRootSessionType): OrchestratorSession | undefined {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM orchestrator_sessions
     WHERE project_id = ?
       AND type = ?
       AND parent_id IS NULL
       AND lifecycle_status != 'archived'
     ORDER BY created_at ASC
     LIMIT 1`
  ).get(projectId, type) as OrchestratorSession | undefined;
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
      throw new AppError('Worker sessions must be created under a feature_lead session', {
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
  const db = getDb();
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
  }

  validateSessionCreation({
    projectId: params.project_id,
    type: params.type,
    resolvedParentId,
  });

  const rolePrompt = getRolePrompt(params.type);
  const knowledgeSnapshot = getProjectKnowledge(params.project_id);
  const composedSystemPrompt = composePrompt(params.type, knowledgeSnapshot, params.goal_and_constraints ?? '');
  const parentSession = resolvedParentId ? getSession(resolvedParentId) : undefined;
  const projectRoleModelConfig = projectsDb.getProjectRoleModelConfig(params.project_id);
  const roleDefaults = projectRoleModelConfig[params.type];
  const resolvedProvider = params.provider ?? roleDefaults?.provider ?? parentSession?.provider ?? null;
  const resolvedModel = params.model ?? roleDefaults?.model ?? parentSession?.model ?? null;

  const stmt = db.prepare(`
    INSERT INTO orchestrator_sessions (
      id, project_id, parent_id, provider, model, type, title,
      interaction_mode, lifecycle_status, run_status,
      system_prompt, role_prompt, project_knowledge_snapshot,
      goal_and_constraints, workspace_path, auto_run
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id, params.project_id, resolvedParentId, resolvedProvider, resolvedModel, params.type, resolvedTitle,
    defaults.interaction_mode, defaults.run_status,
    composedSystemPrompt, rolePrompt, knowledgeSnapshot,
    params.goal_and_constraints ?? '', params.workspace_path ?? null, defaults.auto_run,
  );

  insertEvent(db, id, null, 'session_created', { type: params.type, parent_id: resolvedParentId });

  if (resolvedParentId) {
    insertEvent(db, resolvedParentId, null, 'child_session_created', { child_id: id, child_type: params.type });
  }

  return getSession(id)!;
}

export function getSession(id: string): OrchestratorSession | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM orchestrator_sessions WHERE id = ?').get(id) as OrchestratorSession | undefined;
}

export function getSessionByExternalSessionId(externalSessionId: string): OrchestratorSession | undefined {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM orchestrator_sessions WHERE external_session_id = ? AND lifecycle_status != 'archived' ORDER BY updated_at DESC, created_at DESC LIMIT 1"
  ).get(externalSessionId) as OrchestratorSession | undefined;
}

export function isSessionVisibleInTree(session: OrchestratorSession): boolean {
  return session.lifecycle_status !== 'archived';
}

function syncDescendantSessionConfig(id: string, provider: string, model: string | null): void {
  const db = getDb();
  const descendants = db.prepare(`
    WITH RECURSIVE descendants AS (
      SELECT id, type
      FROM orchestrator_sessions
      WHERE parent_id = ?
      UNION ALL
      SELECT child.id, child.type
      FROM orchestrator_sessions AS child
      INNER JOIN descendants AS parent_descendant ON child.parent_id = parent_descendant.id
    )
    SELECT id, type FROM descendants
    WHERE type IN ('feature_lead', 'worker')
  `).all(id) as Array<{ id: string; type: SessionType }>;

  const updateStmt = db.prepare(
    "UPDATE orchestrator_sessions SET provider = ?, model = ?, updated_at = datetime('now') WHERE id = ?"
  );

  for (const descendant of descendants) {
    updateStmt.run(provider, model, descendant.id);
    insertEvent(db, descendant.id, null, 'status_changed', {
      inherited_from_parent: true,
      provider,
      model,
    });
  }
}

export function initializeSession(id: string, provider: string, model?: string): void {
  const db = getDb();
  db.prepare("UPDATE orchestrator_sessions SET provider = ?, model = ?, updated_at = datetime('now') WHERE id = ?").run(provider, model ?? null, id);
  syncDescendantSessionConfig(id, provider, model ?? null);
  updateSessionStatus(id, { run_status: 'idle' });
  insertEvent(db, id, null, 'status_changed', { initialized: true, provider, model });
}

export function updateSessionStatus(
  id: string,
  updates: Partial<Pick<OrchestratorSession, 'lifecycle_status' | 'run_status' | 'external_session_id' | 'summary_text' | 'last_run_summary' | 'last_error_summary'>>,
): void {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.lifecycle_status !== undefined) {
    sets.push('lifecycle_status = ?');
    values.push(updates.lifecycle_status);
  }
  if (updates.run_status !== undefined) {
    sets.push('run_status = ?');
    values.push(updates.run_status);
  }
  if (updates.external_session_id !== undefined) {
    sets.push('external_session_id = ?');
    values.push(updates.external_session_id);
  }
  if (updates.summary_text !== undefined) {
    sets.push('summary_text = ?');
    values.push(updates.summary_text);
  }
  if (updates.last_run_summary !== undefined) {
    sets.push('last_run_summary = ?');
    values.push(updates.last_run_summary);
  }
  if (updates.last_error_summary !== undefined) {
    sets.push('last_error_summary = ?');
    values.push(updates.last_error_summary);
  }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE orchestrator_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  if (updates.lifecycle_status || updates.run_status) {
    insertEvent(db, id, null, 'status_changed', {
      lifecycle_status: updates.lifecycle_status,
      run_status: updates.run_status,
    });
  }
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
  const db = getDb();
  const session = getSession(id);
  if (!session || session.type !== 'worker') return;
  if (session.lifecycle_status !== 'completed') return;

  db.prepare("UPDATE orchestrator_sessions SET lifecycle_status = 'archived', archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
  insertEvent(db, id, null, 'archived', {});
}

export function getSessionTree(project_id: string): SessionTreeNode[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM orchestrator_sessions WHERE project_id = ? AND lifecycle_status != 'archived' ORDER BY created_at ASC"
  ).all(project_id) as OrchestratorSession[];

  return buildTree(rows.filter(isSessionVisibleInTree));
}

const SESSION_TYPE_ORDER: Record<SessionType, number> = {
  tech_lead: 0,
  feature_lead: 1,
  worker: 2,
  ops: 3,
};

function compareTreeNodes(a: OrchestratorSession, b: OrchestratorSession): number {
  const typeDiff = (SESSION_TYPE_ORDER[a.type] ?? Number.MAX_SAFE_INTEGER) - (SESSION_TYPE_ORDER[b.type] ?? Number.MAX_SAFE_INTEGER);
  if (typeDiff !== 0) {
    return typeDiff;
  }

  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
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
  const db = getDb();
  const row = db.prepare('SELECT content FROM project_knowledge WHERE project_id = ?').get(project_id) as { content: string } | undefined;
  return row?.content ?? '';
}

export function ensureProjectKnowledge(project_id: string, initialContent: string = ''): void {
  const db = getDb();
  db.prepare(
    'INSERT OR IGNORE INTO project_knowledge (id, project_id, content) VALUES (?, ?, ?)'
  ).run(uuidv4(), project_id, initialContent);
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
  const db = getDb();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO worker_task_specs (id, worker_session_id, title, objective, scope, constraints, input_context, expected_output, acceptance_criteria, created_by_session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.worker_session_id, params.title, params.objective, params.scope, params.constraints, params.input_context, params.expected_output, params.acceptance_criteria, params.created_by_session_id);

  insertEvent(db, params.worker_session_id, null, 'task_spec_created', { title: params.title });

  return { id, ...params, created_at: new Date().toISOString() };
}

export function getTaskSpec(worker_session_id: string): WorkerTaskSpec | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM worker_task_specs WHERE worker_session_id = ?').get(worker_session_id) as WorkerTaskSpec | undefined;
}

export function getTaskSpecsByCreator(created_by_session_id: string): WorkerTaskSpec[] {
  const db = getDb();
  return db.prepare('SELECT * FROM worker_task_specs WHERE created_by_session_id = ? ORDER BY created_at DESC').all(created_by_session_id) as WorkerTaskSpec[];
}

export function onWorkerCompleted(workerSessionId: string, success: boolean, runSummary: string, errorSummary?: string): void {
  const db = getDb();
  const worker = getSession(workerSessionId);
  if (!worker || worker.type !== 'worker') return;

  updateSessionStatus(workerSessionId, {
    lifecycle_status: success ? 'completed' : 'failed',
    run_status: 'idle',
    last_run_summary: runSummary,
    last_error_summary: errorSummary ?? '',
  });

  if (worker.parent_id) {
    const summary = `Worker 完成摘要
Worker: ${worker.title}
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
  return workerStartupMessage(spec);
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
  workerStartupContext: string = '',
): string {
  // Put the task payload first so child sessions surface the actual work before background constraints.
  const bootstrapSections: string[] = [];
  if (workerStartupContext) {
    bootstrapSections.push(workerStartupContext);
  }
  bootstrapSections.push(session.system_prompt);

  return [
    ORCHESTRATOR_BOOTSTRAP_OPEN_TAG,
    bootstrapSections.join('\n\n'),
    ORCHESTRATOR_BOOTSTRAP_CLOSE_TAG,
    ORCHESTRATOR_USER_MESSAGE_OPEN_TAG,
    userCommand,
    ORCHESTRATOR_USER_MESSAGE_CLOSE_TAG,
  ].join('\n');
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

  const needsBootstrapPrompt = !session.external_session_id;
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

function insertEvent(db: Database.Database, sessionId: string, runId: string | null, eventType: string, payload: Record<string, unknown>): void {
  db.prepare(
    'INSERT INTO session_events (id, session_id, run_id, event_type, payload_json) VALUES (?, ?, ?, ?, ?)'
  ).run(uuidv4(), sessionId, runId, eventType, JSON.stringify(payload));
}

export function getSessionEvents(sessionId: string, limit: number = 50): Array<{ id: string; event_type: string; payload_json: string; created_at: string }> {
  const db = getDb();
  return db.prepare(
    'SELECT id, event_type, payload_json, created_at FROM session_events WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(sessionId, limit) as Array<{ id: string; event_type: string; payload_json: string; created_at: string }>;
}

export function bindExternalSessionId(localSessionId: string, externalSessionId: string): void {
  updateSessionStatus(localSessionId, { external_session_id: externalSessionId });
}

export function registerChildSessionAutoRunExecutor(executor: ChildSessionAutoRunExecutor | null): void {
  childSessionAutoRunExecutor = executor;
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
  if (parentType === 'feature_lead') {
    return 'worker';
  }
  return null;
}

function isMaterializableTool(toolName: string | null | undefined, toolInput: unknown): boolean {
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

type MaterializedChildLookup = {
  child: OrchestratorSession;
  sourceToolName: string | null;
};

function findMaterializedChildSessionLookup(
  parentSessionId: string,
  sourceToolId: string,
): MaterializedChildLookup | undefined {
  const db = getDb();
  const rows = db.prepare(
    "SELECT payload_json FROM session_events WHERE session_id = ? AND event_type = 'child_session_created' ORDER BY created_at DESC"
  ).all(parentSessionId) as Array<{ payload_json: string }>;

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
    record.external_session_id,
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

function buildChildSessionStartupMessage(session: OrchestratorSession): string {
  if (session.type === 'worker') {
    return getWorkerStartupContext(session.id) || session.goal_and_constraints || '';
  }

  return featureLeadStartupMessage(session.goal_and_constraints || '请承接上级下发目标。', '');
}

function buildChildSessionInitialCommand(session: OrchestratorSession): string {
  const startupMessage = buildChildSessionStartupMessage(session);
  return buildOrchestratorBootstrapPrompt(session, '', startupMessage);
}

async function defaultChildSessionAutoRunExecutor(params: ChildSessionAutoRunParams): Promise<void> {
  const { session, startupMessage } = params;
  const workingDirectory = session.workspace_path || process.cwd();
  const writer = new SilentSessionWriter();
  const commonOptions = {
    cwd: workingDirectory,
    projectPath: workingDirectory,
    sessionId: session.external_session_id ?? undefined,
    resume: Boolean(session.external_session_id),
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
  const initialCommand = buildChildSessionInitialCommand(session);
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

  const childType = deriveChildSessionType(parentSession.type);
  if (!childType || !isMaterializableTool(params.toolName, params.toolInput)) {
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
    return null;
  }

  const existing = findMaterializedChildSession(parentSessionId, sourceToolId);
  if (existing) {
    return existing;
  }

  const goalAndConstraints = deriveGoalAndConstraints(input);
  const title = deriveChildTitle(childType, input);
  const explicitProvider = deriveExplicitProvider(input);
  const explicitModel = deriveExplicitModel(input);

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

  const db = getDb();
  insertEvent(db, parentSession.id, null, 'child_session_created', {
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
    if (!session.external_session_id) {
      queueChildSessionAutoRun(session.id);
    }
    return session;
  }

  const bound = bindChildRuntimeFromTool(parentSessionId, {
    toolId: sourceToolId,
    runtimeInfo: params.runtimeInfo,
  }) ?? getSession(session.id) ?? session;

  if (!bound.external_session_id) {
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
    return null;
  }

  const materializedChild = findMaterializedChildSessionLookup(parentSessionId, sourceToolId);
  if (!materializedChild) {
    return null;
  }

  const runtimeSessionId = extractRuntimeSessionId(params.runtimeInfo, {
    allowGenericId: isSpawnAgentToolName(materializedChild.sourceToolName),
  });
  if (!runtimeSessionId) {
    return null;
  }

  const child = materializedChild.child;

  if (child.external_session_id === runtimeSessionId) {
    return child;
  }

  updateSessionStatus(child.id, {
    external_session_id: runtimeSessionId,
    run_status: 'running',
    lifecycle_status: 'active',
  });

  const db = getDb();
  insertEvent(db, child.id, null, 'status_changed', {
    external_session_id: runtimeSessionId,
    bound_from_parent_tool: true,
    parent_session_id: parentSessionId,
    source_tool_id: sourceToolId,
  });

  return getSession(child.id) ?? child;
}
