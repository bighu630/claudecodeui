import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getSessionOrchestratorId,
  getSessionRouteId,
  getSessionRuntimeId,
  isOrchestratorSession,
  normalizeOrchestratorSession,
} from './sessionIdentity.ts';

const makeOrchestratorSession = (overrides = {}) => ({
  id: 'orch_123',
  project_id: 'project_1',
  parent_id: null,
  provider: 'codex',
  model: 'gpt-5.4',
  type: 'feature_lead',
  title: 'Feature lead',
  interaction_mode: 'managed',
  lifecycle_status: 'active',
  run_status: 'idle',
  runtime_session_id: 'runtime_456',
  system_prompt: '',
  role_prompt: '',
  project_knowledge_snapshot: '',
  goal_and_constraints: '',
  workspace_path: '/tmp/project',
  auto_run: 0,
  summary_text: 'Summary',
  last_run_summary: '',
  last_error_summary: '',
  created_at: '2026-05-25T00:00:00.000Z',
  updated_at: '2026-05-25T00:00:00.000Z',
  archived_at: null,
  ...overrides,
});

test('normalizeOrchestratorSession uses runtime_session_id as ProjectSession.id when available', () => {
  const normalized = normalizeOrchestratorSession(makeOrchestratorSession(), 'project_1');

  assert.equal(normalized.id, 'runtime_456');  // runtime_session_id takes priority
  assert.equal(normalized.orchestratorSessionId, 'orch_123');
  assert.equal(normalized.runtime_session_id, 'runtime_456');
  assert.equal(getSessionRuntimeId(normalized), 'runtime_456');
  assert.equal(getSessionRouteId(normalized), 'runtime_456');
  assert.equal(getSessionOrchestratorId(normalized), 'orch_123');
  assert.equal('runtimeSessionId' in normalized, false);
});

test('uninitialized orchestrator sessions keep auxiliary orchestrator identity only', () => {
  const normalized = normalizeOrchestratorSession(
    makeOrchestratorSession({
      id: 'orch_pending',
      provider: null,
      model: null,
      runtime_session_id: null,
    }),
    'project_1',
  );

  assert.equal(normalized.id, 'orch_pending');
  assert.equal(isOrchestratorSession(normalized), true);
  assert.equal(getSessionRuntimeId(normalized), null);
  assert.equal(getSessionRouteId(normalized), 'orch_pending');
  assert.equal(getSessionOrchestratorId(normalized), 'orch_pending');
});

test('plain provider sessions use id as the primary runtime and route id', () => {
  const session = {
    id: 'provider_789',
    title: 'Provider session',
    __provider: 'claude',
  };

  assert.equal(isOrchestratorSession(session), false);
  assert.equal(getSessionRuntimeId(session), 'provider_789');
  assert.equal(getSessionRouteId(session), 'provider_789');
  assert.equal(getSessionOrchestratorId(session), null);
});

test('legacy runtimeSessionId remains readable as a compatibility alias', () => {
  const session = {
    id: 'provider_789',
    runtimeSessionId: 'legacy_runtime_123',
  };

  assert.equal(getSessionRuntimeId(session), 'legacy_runtime_123');
});
