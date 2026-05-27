import { v4 as uuidv4 } from 'uuid';

import { getConnection } from '@/modules/database/connection.js';

import type { OrchestratorSession, WorkerTaskSpec } from '@/modules/orchestrator/index.js';
import type { SessionType } from '@/modules/orchestrator/index.js';

type BootstrapRootSessionType = Extract<SessionType, 'tech_lead' | 'ops'>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function recordEvent(
  sessionId: string,
  runId: string | null,
  eventType: string,
  payload: Record<string, unknown>,
): void {
  const db = getConnection();
  db.prepare(
    'INSERT INTO session_events (id, session_id, run_id, event_type, payload_json) VALUES (?, ?, ?, ?, ?)',
  ).run(uuidv4(), sessionId, runId, eventType, JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Public repository
// ---------------------------------------------------------------------------

export const orchestratorSessionsDb = {
  // =========================================================================
  // orchestrator_sessions
  // =========================================================================

  getSession(id: string): OrchestratorSession | undefined {
    const db = getConnection();
    return db.prepare('SELECT * FROM orchestrator_sessions WHERE id = ?').get(id) as
      | OrchestratorSession
      | undefined;
  },

  getSessionByRuntimeSessionId(externalSessionId: string): OrchestratorSession | undefined {
    const db = getConnection();
    return db.prepare(
      "SELECT * FROM orchestrator_sessions WHERE runtime_session_id = ? AND lifecycle_status != 'archived' ORDER BY updated_at DESC, created_at DESC LIMIT 1",
    ).get(externalSessionId) as OrchestratorSession | undefined;
  },

  getTechLeadSession(projectId: string): OrchestratorSession | undefined {
    const db = getConnection();
    return db.prepare(
      "SELECT * FROM orchestrator_sessions WHERE project_id = ? AND type = 'tech_lead' AND lifecycle_status != 'archived' ORDER BY created_at ASC LIMIT 1",
    ).get(projectId) as OrchestratorSession | undefined;
  },

  getActiveRootSession(
    projectId: string,
    type: BootstrapRootSessionType,
  ): OrchestratorSession | undefined {
    const db = getConnection();
    return db.prepare(
      `SELECT * FROM orchestrator_sessions
       WHERE project_id = ?
         AND type = ?
         AND parent_id IS NULL
         AND lifecycle_status != 'archived'
       ORDER BY created_at ASC
       LIMIT 1`,
    ).get(projectId, type) as OrchestratorSession | undefined;
  },

  getAllSessionsForProject(projectId: string): OrchestratorSession[] {
    const db = getConnection();
    return db.prepare(
      "SELECT * FROM orchestrator_sessions WHERE project_id = ? AND lifecycle_status != 'archived' ORDER BY created_at ASC",
    ).all(projectId) as OrchestratorSession[];
  },

  /** Insert a new orchestrator session row and return the freshly-inserted record. */
  createSession(params: {
    id: string;
    project_id: string;
    parent_id: string | null;
    provider: string | null;
    model: string | null;
    type: SessionType;
    title: string;
    interaction_mode: string;
    run_status: string;
    system_prompt: string;
    role_prompt: string;
    project_knowledge_snapshot: string;
    goal_and_constraints: string;
    workspace_path: string | null;
    auto_run: number;
  }): OrchestratorSession {
    const db = getConnection();
    db.prepare(`
      INSERT INTO orchestrator_sessions (
        id, project_id, parent_id, provider, model, type, title,
        interaction_mode, lifecycle_status, run_status,
        system_prompt, role_prompt, project_knowledge_snapshot,
        goal_and_constraints, workspace_path, auto_run
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.id,
      params.project_id,
      params.parent_id,
      params.provider,
      params.model,
      params.type,
      params.title,
      params.interaction_mode,
      params.run_status,
      params.system_prompt,
      params.role_prompt,
      params.project_knowledge_snapshot,
      params.goal_and_constraints,
      params.workspace_path,
      params.auto_run,
    );

    return db.prepare('SELECT * FROM orchestrator_sessions WHERE id = ?').get(params.id) as OrchestratorSession;
  },

  updateSessionStatus(
    id: string,
    updates: Partial<
      Pick<
        OrchestratorSession,
        'lifecycle_status' | 'run_status' | 'runtime_session_id' | 'summary_text' | 'last_run_summary' | 'last_error_summary'
      >
    >,
  ): void {
    const db = getConnection();
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
    if (updates.runtime_session_id !== undefined) {
      sets.push('runtime_session_id = ?');
      values.push(updates.runtime_session_id);
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
      recordEvent(id, null, 'status_changed', {
        lifecycle_status: updates.lifecycle_status,
        run_status: updates.run_status,
      });
    }
  },

  archiveWorker(id: string): void {
    const db = getConnection();
    db.prepare(
      "UPDATE orchestrator_sessions SET lifecycle_status = 'archived', archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    recordEvent(id, null, 'archived', {});
  },

  initializeSession(id: string, provider: string, model: string | null): void {
    const db = getConnection();
    db.prepare(
      "UPDATE orchestrator_sessions SET provider = ?, model = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(provider, model, id);
    recordEvent(id, null, 'status_changed', { initialized: true, provider, model });
  },

  syncDescendantSessionConfig(id: string, provider: string, model: string | null): void {
    const db = getConnection();
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
      "UPDATE orchestrator_sessions SET provider = ?, model = ?, updated_at = datetime('now') WHERE id = ?",
    );

    for (const descendant of descendants) {
      updateStmt.run(provider, model, descendant.id);
      recordEvent(descendant.id, null, 'status_changed', {
        inherited_from_parent: true,
        provider,
        model,
      });
    }
  },

  // =========================================================================
  // project_knowledge
  // =========================================================================

  getProjectKnowledge(projectId: string): string {
    const db = getConnection();
    const row = db.prepare('SELECT content FROM project_knowledge WHERE project_id = ?').get(projectId) as
      | { content: string }
      | undefined;
    return row?.content ?? '';
  },

  ensureProjectKnowledge(projectId: string, initialContent: string = ''): void {
    const db = getConnection();
    db.prepare('INSERT OR IGNORE INTO project_knowledge (id, project_id, content) VALUES (?, ?, ?)').run(
      uuidv4(),
      projectId,
      initialContent,
    );
  },

  // =========================================================================
  // worker_task_specs
  // =========================================================================

  createTaskSpec(params: Omit<WorkerTaskSpec, 'id' | 'created_at'>): WorkerTaskSpec {
    const db = getConnection();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO worker_task_specs (id, worker_session_id, title, objective, scope, constraints, input_context, expected_output, acceptance_criteria, created_by_session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.worker_session_id,
      params.title,
      params.objective,
      params.scope,
      params.constraints,
      params.input_context,
      params.expected_output,
      params.acceptance_criteria,
      params.created_by_session_id,
    );

    recordEvent(params.worker_session_id, null, 'task_spec_created', { title: params.title });

    return { id, ...params, created_at: new Date().toISOString() };
  },

  getTaskSpec(workerSessionId: string): WorkerTaskSpec | undefined {
    const db = getConnection();
    return db.prepare('SELECT * FROM worker_task_specs WHERE worker_session_id = ?').get(workerSessionId) as
      | WorkerTaskSpec
      | undefined;
  },

  getTasksByParentSessionId(createdBySessionId: string): WorkerTaskSpec[] {
    const db = getConnection();
    return db.prepare(
      'SELECT * FROM worker_task_specs WHERE created_by_session_id = ? ORDER BY created_at DESC',
    ).all(createdBySessionId) as WorkerTaskSpec[];
  },

  // =========================================================================
  // session_events
  // =========================================================================

  recordSessionEvent(params: {
    sessionId: string;
    runId: string | null;
    eventType: string;
    payload: Record<string, unknown>;
  }): void {
    recordEvent(params.sessionId, params.runId, params.eventType, params.payload);
  },

  getSessionEvents(
    sessionId: string,
    limit: number = 50,
  ): Array<{ id: string; event_type: string; payload_json: string; created_at: string }> {
    const db = getConnection();
    return db.prepare(
      'SELECT id, event_type, payload_json, created_at FROM session_events WHERE session_id = ? ORDER BY created_at DESC LIMIT ?',
    ).all(sessionId, limit) as Array<{
      id: string;
      event_type: string;
      payload_json: string;
      created_at: string;
    }>;
  },

  /** Returns raw payload_json rows for child_session_created events under a parent. */
  getToolCallPayloadsByParentSessionId(
    parentSessionId: string,
  ): Array<{ payload_json: string }> {
    const db = getConnection();
    return db.prepare(
      "SELECT payload_json FROM session_events WHERE session_id = ? AND event_type = 'child_session_created' ORDER BY created_at DESC",
    ).all(parentSessionId) as Array<{ payload_json: string }>;
  },

  /** Insert a child_session_created event (used during materializeChildSessionFromTool). */
  recordChildSessionCreated(
    parentSessionId: string,
    payload: {
      child_id: string;
      child_type: string;
      source_tool_id: string;
      source_tool_name: string | null;
      startup_prompt: string;
    },
  ): void {
    recordEvent(parentSessionId, null, 'child_session_created', payload as Record<string, unknown>);
  },

  /** Insert a status_changed event with runtime binding info. */
  recordRuntimeBindEvent(
    childId: string,
    payload: Record<string, unknown>,
  ): void {
    recordEvent(childId, null, 'status_changed', payload);
  },
};
