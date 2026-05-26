import { Router, type Response } from 'express';

import { AppError } from '@/shared/utils.js';

import * as orch from './orchestrator.service.js';
import { featureLeadStartupMessage } from './prompts.js';
import type { SessionType } from './prompts.js';
import type { OrchestratorSession } from './orchestrator.service.js';

const router = Router();

function respondWithRouteError(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  res.status(statusCode).json({ error: message });
}

router.get('/projects/:projectId/tree', (req, res) => {
  try {
    const tree = orch.getSessionTree(req.params.projectId);
    res.json({ tree });
  } catch (err: unknown) {
    respondWithRouteError(res, err);
  }
});

router.get('/sessions/:id', (req, res) => {
  try {
    const session = orch.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const taskSpec = session.type === 'worker' ? orch.getTaskSpec(req.params.id) : null;
    const events = orch.getSessionEvents(req.params.id);
    res.json({ session, taskSpec, events });
  } catch (err: unknown) {
    respondWithRouteError(res, err);
  }
});

router.get('/runtime/:externalSessionId', (req, res) => {
  try {
    const session = orch.getSessionByExternalSessionId(req.params.externalSessionId);
    if (!session || !orch.isSessionVisibleInTree(session)) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const taskSpec = session.type === 'worker' ? orch.getTaskSpec(session.id) : null;
    const events = orch.getSessionEvents(session.id);
    res.json({ session, taskSpec, events });
  } catch (err: unknown) {
    respondWithRouteError(res, err);
  }
});

router.post('/sessions', (req, res) => {
  try {
    const { project_id, parent_id, provider, model, type, title, workspace_path, goal_and_constraints } = req.body as Record<string, unknown>;

    if (!project_id || !type) {
      return res.status(400).json({ error: 'Missing required fields: project_id, type' });
    }

    const rawGoal = typeof goal_and_constraints === 'string' ? goal_and_constraints : '';
    const rawTitle = typeof title === 'string' ? title : '';
    const resolvedTitle = rawTitle.trim() || rawGoal.trim();

    if (!resolvedTitle) {
      return res.status(400).json({ error: 'Missing session title or goal_and_constraints summary' });
    }

    if (parent_id && type !== 'feature_lead') {
      const parent = orch.getSession(parent_id as string);
      if (!parent) return res.status(404).json({ error: 'Parent session not found' });
      if (!orch.canCreateChild(parent.type as SessionType, type as SessionType)) {
        return res.status(403).json({
          error: `Session type '${parent.type}' cannot create child of type '${type}'`,
        });
      }
    }

    const session = orch.createSession({
      project_id: project_id as string,
      parent_id: (parent_id as string) ?? null,
      provider: provider as string | undefined,
      model: model as string | undefined,
      type: type as SessionType,
      title: resolvedTitle,
      workspace_path: workspace_path as string | undefined,
      goal_and_constraints: goal_and_constraints as string | undefined,
    });

    let startupMessage: string | null = null;
    if (type === 'feature_lead') {
      startupMessage = featureLeadStartupMessage(
        rawGoal || session.goal_and_constraints,
        '',
      );
    }

    res.status(201).json({ session, startupMessage });
  } catch (err: unknown) {
    respondWithRouteError(res, err);
  }
});

router.patch('/sessions/:id/status', (req, res) => {
  try {
    const { lifecycle_status, run_status, external_session_id, summary_text, last_run_summary, last_error_summary } = req.body as Record<string, unknown>;
    orch.updateSessionStatus(req.params.id, {
      lifecycle_status: lifecycle_status as OrchestratorSession['lifecycle_status'] | undefined,
      run_status: run_status as OrchestratorSession['run_status'] | undefined,
      external_session_id: external_session_id as string | undefined,
      summary_text: summary_text as string | undefined,
      last_run_summary: last_run_summary as string | undefined,
      last_error_summary: last_error_summary as string | undefined,
    });
    res.json({ success: true });
  } catch (err: unknown) {
    respondWithRouteError(res, err);
  }
});

router.patch('/sessions/:id/initialize', (req, res) => {
  try {
    const { provider, model } = req.body as Record<string, unknown>;
    if (!provider) return res.status(400).json({ error: 'provider is required' });
    orch.initializeSession(req.params.id, provider as string, model as string | undefined);
    res.json({ success: true });
  } catch (err: unknown) {
    respondWithRouteError(res, err);
  }
});

router.post('/sessions/:id/archive', (req, res) => {
  try {
    orch.archiveWorker(req.params.id);
    res.json({ success: true });
  } catch (err: unknown) {
    respondWithRouteError(res, err);
  }
});

router.post('/sessions/:id/task-spec', (req, res) => {
  try {
    const session = orch.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.type !== 'worker') return res.status(400).json({ error: 'Task specs only valid for worker sessions' });

    const { title, objective, scope, constraints, input_context, expected_output, acceptance_criteria, created_by_session_id } = req.body as Record<string, unknown>;
    const requiredFields: Record<string, unknown> = { title, objective, scope, constraints, input_context, expected_output, acceptance_criteria, created_by_session_id };
    const missing = Object.entries(requiredFields).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    const spec = orch.createTaskSpec({
      worker_session_id: req.params.id,
      title: title as string,
      objective: objective as string,
      scope: scope as string,
      constraints: constraints as string,
      input_context: input_context as string,
      expected_output: expected_output as string,
      acceptance_criteria: acceptance_criteria as string,
      created_by_session_id: created_by_session_id as string,
    });

    res.status(201).json({ taskSpec: spec });
  } catch (err: unknown) {
    respondWithRouteError(res, err);
  }
});

router.post('/sessions/:id/worker-completed', (req, res) => {
  try {
    const { success, runSummary, errorSummary } = req.body as Record<string, unknown>;
    orch.onWorkerCompleted(req.params.id, success as boolean, runSummary as string, errorSummary as string | undefined);
    res.json({ success: true });
  } catch (err: unknown) {
    respondWithRouteError(res, err);
  }
});

router.get('/projects/:projectId/knowledge', (req, res) => {
  try {
    const content = orch.getProjectKnowledge(req.params.projectId);
    res.json({ content });
  } catch (err: unknown) {
    respondWithRouteError(res, err);
  }
});

export default router;
