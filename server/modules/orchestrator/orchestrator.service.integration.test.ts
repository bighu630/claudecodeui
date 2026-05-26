import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb } from '@/modules/database/index.js';
import { getDefaultProjectRoleModelConfig } from '@/modules/projects/index.js';
import {
  bindChildRuntimeFromTool,
  bindExternalSessionId,
  createSession,
  ensureProjectOrchestratorBootstrap,
  finalizeOrchestratorRun,
  getProjectKnowledge,
  getSession,
  getSessionByExternalSessionId,
  getSessionEvents,
  getSessionTree,
  getTaskSpec,
  materializeAndBindChildSessionFromTool,
  materializeChildSessionFromTool,
  prepareOrchestratorCommand,
  registerChildSessionAutoRunExecutor,
} from '@/modules/orchestrator/orchestrator.service.js';
import { AppError } from '@/shared/utils.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'orchestrator-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function createProjectFixture(projectPath: string): string {
  const result = projectsDb.createProjectPath(projectPath, path.basename(projectPath));
  const projectId = result.project?.project_id;
  assert.ok(projectId);
  projectsDb.saveProjectRoleModelConfig(projectId, getDefaultProjectRoleModelConfig());
  return projectId;
}

test('ensureProjectOrchestratorBootstrap creates unique root sessions and project knowledge idempotently', async () => {
  await withIsolatedDatabase(() => {
    const projectId = createProjectFixture('/workspace/bootstrap-project');

    const firstBootstrap = ensureProjectOrchestratorBootstrap({
      projectId,
      workspacePath: '/workspace/bootstrap-project',
    });
    const secondBootstrap = ensureProjectOrchestratorBootstrap({
      projectId,
      workspacePath: '/workspace/bootstrap-project',
    });

    assert.equal(firstBootstrap.techLead.id, secondBootstrap.techLead.id);
    assert.equal(firstBootstrap.ops.id, secondBootstrap.ops.id);
    assert.equal(getProjectKnowledge(projectId), '');

    const tree = getSessionTree(projectId);
    assert.deepEqual(
      tree.map((node) => node.type),
      ['tech_lead', 'ops'],
    );
  });
});

test('createSession enforces orchestrator role derivation rules', async () => {
  await withIsolatedDatabase(() => {
    const projectId = createProjectFixture('/workspace/hierarchy-project');
    const { techLead, ops } = ensureProjectOrchestratorBootstrap({
      projectId,
      workspacePath: '/workspace/hierarchy-project',
    });

    assert.throws(
      () =>
        createSession({
          project_id: projectId,
          parent_id: null,
          type: 'worker',
          title: 'illegal worker',
        }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'ORCHESTRATOR_INVALID_ROOT_WORKER');
        return true;
      },
    );

    assert.throws(
      () =>
        createSession({
          project_id: projectId,
          parent_id: ops.id,
          type: 'worker',
          title: 'illegal worker under ops',
        }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'ORCHESTRATOR_INVALID_DERIVATION');
        return true;
      },
    );

    const featureLead = createSession({
      project_id: projectId,
      parent_id: techLead.id,
      type: 'feature_lead',
      title: 'feature work',
      goal_and_constraints: 'ship feature',
    });

    const worker = createSession({
      project_id: projectId,
      parent_id: featureLead.id,
      type: 'worker',
      title: 'worker task',
    });

    assert.equal(worker.parent_id, featureLead.id);
  });
});

test('materializeChildSessionFromTool and bindChildRuntimeFromTool bridge namespaced spawn_agent flows into orchestrator sessions', async () => {
  await withIsolatedDatabase(() => {
    const projectId = createProjectFixture('/workspace/materialize-project');
    const { techLead } = ensureProjectOrchestratorBootstrap({
      projectId,
      workspacePath: '/workspace/materialize-project',
    });

    const initializedTechLead = getSession(techLead.id);
    assert.ok(initializedTechLead);
    assert.equal(initializedTechLead.provider, 'codex');
    assert.equal(initializedTechLead.model, 'gpt-5.5');

    const ignored = materializeChildSessionFromTool(techLead.id, {
      toolName: 'Bash',
      toolId: 'tool-bash',
      toolInput: { prompt: 'echo hello' },
    });
    assert.equal(ignored, null);

    const featureLead = materializeChildSessionFromTool(techLead.id, {
      toolName: 'Task',
      toolId: 'tool-feature-1',
      toolInput: { description: 'Implement project bootstrap' },
    });
    assert.ok(featureLead);
    assert.equal(featureLead.type, 'feature_lead');
    assert.equal(featureLead.provider, 'codex');
    assert.equal(featureLead.model, 'gpt-5.4');

    const sameFeatureLead = materializeChildSessionFromTool(techLead.id, {
      toolName: 'Task',
      toolId: 'tool-feature-1',
      toolInput: { description: 'Implement project bootstrap' },
    });
    assert.equal(sameFeatureLead?.id, featureLead.id);

    const missingToolId = materializeChildSessionFromTool(featureLead.id, {
      toolName: 'spawn_agent',
      toolInput: { message: 'missing tool id should not materialize' },
    });
    assert.equal(missingToolId, null);

    const worker = materializeChildSessionFromTool(featureLead.id, {
      toolName: 'functions.spawn_agent',
      toolId: 'tool-worker-1',
      toolInput: {
        message: 'Apply the fix',
        scope: 'Only update orchestrator bootstrap paths',
        constraints: 'Stay in scope',
        expected_output: 'Code + verification',
        acceptance_criteria: 'Tests pass',
      },
    });
    assert.ok(worker);
    assert.equal(worker.type, 'worker');
    assert.equal(worker.provider, 'codex');
    assert.equal(worker.model, 'gpt-5.3');
    assert.ok(getTaskSpec(worker.id));

    const ignoredBinding = bindChildRuntimeFromTool(featureLead.id, {
      toolId: 'tool-missing-worker',
      runtimeInfo: { id: 'generic-id-should-not-bind' },
    });
    assert.equal(ignoredBinding, null);

    const boundWorker = bindChildRuntimeFromTool(featureLead.id, {
      toolId: 'tool-worker-1',
      runtimeInfo: { id: 'worker-runtime-1', nickname: 'worker-1' },
    });
    assert.equal(boundWorker?.external_session_id, 'worker-runtime-1');
    assert.equal(getSession(worker.id)?.external_session_id, 'worker-runtime-1');
  });
});

test('tech_lead-created feature_lead sessions enter the tree before runtime binding', async () => {
  await withIsolatedDatabase(() => {
    const projectId = createProjectFixture('/workspace/tree-feature-project');
    const { techLead } = ensureProjectOrchestratorBootstrap({
      projectId,
      workspacePath: '/workspace/tree-feature-project',
    });

    const featureLead = materializeChildSessionFromTool(techLead.id, {
      toolName: 'Task',
      toolId: 'tool-feature-tree-1',
      toolInput: {
        description: 'Implement the feature session bridge',
      },
    });

    assert.ok(featureLead);
    assert.equal(featureLead.external_session_id, null);

    const tree = getSessionTree(projectId);
    const techLeadNode = tree.find((node) => node.id === techLead.id);
    assert.ok(techLeadNode);

    const featureLeadNode = techLeadNode.children.find((node) => node.id === featureLead.id);
    assert.ok(featureLeadNode);
    assert.equal(featureLeadNode.type, 'feature_lead');
    assert.equal(featureLeadNode.external_session_id, null);
  });
});

test('feature_lead-created worker sessions enter the tree and remain traceable after runtime binding', async () => {
  await withIsolatedDatabase(() => {
    const projectId = createProjectFixture('/workspace/tree-worker-project');
    const { techLead } = ensureProjectOrchestratorBootstrap({
      projectId,
      workspacePath: '/workspace/tree-worker-project',
    });

    const featureLead = materializeChildSessionFromTool(techLead.id, {
      toolName: 'Task',
      toolId: 'tool-feature-tree-2',
      toolInput: {
        description: 'Own the implementation',
      },
    });

    assert.ok(featureLead);

    const worker = materializeChildSessionFromTool(featureLead.id, {
      toolName: 'spawn_agent',
      toolId: 'tool-worker-tree-1',
      toolInput: {
        message: 'Patch the orchestrator tree bridge',
        scope: 'Only the child-session chain',
      },
    });

    assert.ok(worker);
    assert.equal(worker.external_session_id, null);

    const beforeBindTree = getSessionTree(projectId);
    const techLeadNode = beforeBindTree.find((node) => node.id === techLead.id);
    assert.ok(techLeadNode);
    const featureLeadNode = techLeadNode.children.find((node) => node.id === featureLead.id);
    assert.ok(featureLeadNode);
    const workerNode = featureLeadNode.children.find((node) => node.id === worker.id);
    assert.ok(workerNode);
    assert.equal(workerNode.type, 'worker');

    const boundWorker = bindChildRuntimeFromTool(featureLead.id, {
      toolId: 'tool-worker-tree-1',
      runtimeInfo: { agentId: 'worker-runtime-tree-1' },
    });

    assert.ok(boundWorker);
    assert.equal(boundWorker.external_session_id, 'worker-runtime-tree-1');
    assert.equal(getSessionByExternalSessionId('worker-runtime-tree-1')?.id, worker.id);

    const statusEvents = getSessionEvents(worker.id).filter((event) => event.event_type === 'status_changed');
    assert.ok(statusEvents.length > 0);
    assert.ok(
      statusEvents.some((event) => event.payload_json.includes('worker-runtime-tree-1')),
      'expected a runtime binding event to be recorded for the worker session',
    );

    const afterBindTree = getSessionTree(projectId);
    const reboundTechLeadNode = afterBindTree.find((node) => node.id === techLead.id);
    assert.ok(reboundTechLeadNode);
    const reboundFeatureLeadNode = reboundTechLeadNode.children.find((node) => node.id === featureLead.id);
    assert.ok(reboundFeatureLeadNode);
    const reboundWorkerNode = reboundFeatureLeadNode.children.find((node) => node.id === worker.id);
    assert.ok(reboundWorkerNode);
    assert.equal(reboundWorkerNode.external_session_id, 'worker-runtime-tree-1');
  });
});

test('materializeChildSessionFromTool honors explicit provider/model overrides from delegation payload', async () => {
  await withIsolatedDatabase(() => {
    const projectId = createProjectFixture('/workspace/materialize-override-project');
    const { techLead } = ensureProjectOrchestratorBootstrap({
      projectId,
      workspacePath: '/workspace/materialize-override-project',
    });

    const featureLead = materializeChildSessionFromTool(techLead.id, {
      toolName: 'Task',
      toolId: 'tool-feature-override-1',
      toolInput: {
        description: 'Use a different provider',
        provider: 'claude',
        model: 'claude-sonnet-4-20250514',
      },
    });

    assert.ok(featureLead);
    assert.equal(featureLead.provider, 'claude');
    assert.equal(featureLead.model, 'claude-sonnet-4-20250514');
  });
});

test('materializeAndBindChildSessionFromTool writes external_session_id immediately when runtime id is returned with delegation', async () => {
  await withIsolatedDatabase(() => {
    const projectId = createProjectFixture('/workspace/direct-bind-project');
    const { techLead } = ensureProjectOrchestratorBootstrap({
      projectId,
      workspacePath: '/workspace/direct-bind-project',
    });

    const featureLead = materializeAndBindChildSessionFromTool(techLead.id, {
      toolName: 'Task',
      toolId: 'tool-feature-direct-1',
      toolInput: {
        description: 'Implement direct runtime binding',
        session_role: 'feature_lead',
      },
      runtimeInfo: {
        agent_id: 'feature-runtime-direct-1',
      },
    });

    assert.ok(featureLead);
    assert.equal(featureLead.type, 'feature_lead');
    assert.equal(featureLead.external_session_id, 'feature-runtime-direct-1');
    assert.equal(getSession(featureLead.id)?.external_session_id, 'feature-runtime-direct-1');
  });
});

test('materializeAndBindChildSessionFromTool accepts functions.spawn_agent tool names and binds direct agent ids for tech_lead-created feature_leads', async () => {
  await withIsolatedDatabase(() => {
    const projectId = createProjectFixture('/workspace/functions-spawn-agent-project');
    const { techLead } = ensureProjectOrchestratorBootstrap({
      projectId,
      workspacePath: '/workspace/functions-spawn-agent-project',
    });

    const featureLead = materializeAndBindChildSessionFromTool(techLead.id, {
      toolName: 'functions.spawn_agent',
      toolId: 'tool-feature-functions-1',
      toolInput: {
        message: 'Implement the feature bridge',
      },
      runtimeInfo: {
        id: 'feature-runtime-functions-1',
        nickname: 'feature-bridge',
      },
    });

    assert.ok(featureLead);
    assert.equal(featureLead.type, 'feature_lead');
    assert.equal(featureLead.external_session_id, 'feature-runtime-functions-1');
    assert.equal(getSessionByExternalSessionId('feature-runtime-functions-1')?.id, featureLead.id);

    const tree = getSessionTree(projectId);
    const techLeadNode = tree.find((node) => node.id === techLead.id);
    assert.ok(techLeadNode);
    const featureLeadNode = techLeadNode.children.find((node) => node.id === featureLead.id);
    assert.ok(featureLeadNode);
    assert.equal(featureLeadNode.external_session_id, 'feature-runtime-functions-1');
  });
});

test('materializeChildSessionFromTool treats collab_tool_call as a materializable delegation for tech_lead-created feature_leads', async () => {
  await withIsolatedDatabase(() => {
    const projectId = createProjectFixture('/workspace/collab-tool-feature-project');
    const { techLead } = ensureProjectOrchestratorBootstrap({
      projectId,
      workspacePath: '/workspace/collab-tool-feature-project',
    });

    const featureLead = materializeChildSessionFromTool(techLead.id, {
      toolName: 'collab_tool_call',
      toolId: 'tool-feature-collab-1',
      toolInput: {
        message: 'You are the current project feature_lead. Implement the delegation bridge.',
      },
    });

    assert.ok(featureLead);
    assert.equal(featureLead.type, 'feature_lead');
    assert.equal(featureLead.external_session_id, null);

    const tree = getSessionTree(projectId);
    const techLeadNode = tree.find((node) => node.id === techLead.id);
    assert.ok(techLeadNode);
    const featureLeadNode = techLeadNode.children.find((node) => node.id === featureLead.id);
    assert.ok(featureLeadNode);
    assert.equal(featureLeadNode.type, 'feature_lead');
  });
});

test('materializeChildSessionFromTool treats collab_tool_call as a materializable delegation for feature_lead-created workers', async () => {
  await withIsolatedDatabase(() => {
    const projectId = createProjectFixture('/workspace/collab-tool-worker-project');
    const { techLead } = ensureProjectOrchestratorBootstrap({
      projectId,
      workspacePath: '/workspace/collab-tool-worker-project',
    });

    const featureLead = materializeChildSessionFromTool(techLead.id, {
      toolName: 'collab_tool_call',
      toolId: 'tool-feature-collab-2',
      toolInput: {
        message: 'You are the current project feature_lead. Own the implementation.',
      },
    });

    assert.ok(featureLead);

    const worker = materializeChildSessionFromTool(featureLead.id, {
      toolName: 'collab_tool_call',
      toolId: 'tool-worker-collab-1',
      toolInput: {
        message: 'You are a worker. Patch the orchestrator materialization rule.',
        scope: 'Only update child-session tool recognition and tests',
        constraints: 'Do not expand into unrelated identity changes',
      },
    });

    assert.ok(worker);
    assert.equal(worker.type, 'worker');
    assert.ok(getTaskSpec(worker.id));

    const tree = getSessionTree(projectId);
    const techLeadNode = tree.find((node) => node.id === techLead.id);
    assert.ok(techLeadNode);
    const featureLeadNode = techLeadNode.children.find((node) => node.id === featureLead.id);
    assert.ok(featureLeadNode);
    const workerNode = featureLeadNode.children.find((node) => node.id === worker.id);
    assert.ok(workerNode);
    assert.equal(workerNode.type, 'worker');
  });
});

test('materializeAndBindChildSessionFromTool auto-runs child sessions and only enters running after provider start', async () => {
  await withIsolatedDatabase(async () => {
    const projectId = createProjectFixture('/workspace/child-autorun-project');
    const { techLead } = ensureProjectOrchestratorBootstrap({
      projectId,
      workspacePath: '/workspace/child-autorun-project',
    });

    const control: { releaseRun: (() => void) | null } = { releaseRun: null };
    let seenStartupMessage = '';
    let seenSessionId = '';

    registerChildSessionAutoRunExecutor(async ({ session, startupMessage }) => {
      seenSessionId = session.id;
      seenStartupMessage = startupMessage;
      const beforeStart = getSession(session.id);
      assert.ok(beforeStart);
      assert.equal(beforeStart.run_status, 'queued');
      assert.equal(beforeStart.external_session_id, null);

      const preparedCommand = prepareOrchestratorCommand(session.id, startupMessage);
      assert.equal(preparedCommand, startupMessage);
      bindExternalSessionId(session.id, 'feature-autorun-runtime-1');

      await new Promise<void>((resolve) => {
        control.releaseRun = resolve;
      });

      finalizeOrchestratorRun(session.id, {
        success: true,
        runSummary: 'child auto-run completed',
      });
    });

    try {
      const featureLead = materializeAndBindChildSessionFromTool(techLead.id, {
        toolName: 'Task',
        toolId: 'tool-feature-autorun-1',
        toolInput: {
          description: 'Implement child auto-run',
        },
        runtimeInfo: {
          note: 'no runtime id yet',
        },
      });

      assert.ok(featureLead);
      assert.equal(featureLead.type, 'feature_lead');
      assert.equal(featureLead.run_status, 'queued');
      assert.equal(featureLead.external_session_id, null);

      await flushMicrotasks();

      assert.equal(seenSessionId, featureLead.id);
      assert.ok(seenStartupMessage.includes('<orchestrator_bootstrap>'));
      assert.ok(seenStartupMessage.includes('Implement child auto-run'));

      const runningSession = getSession(featureLead.id);
      assert.ok(runningSession);
      assert.equal(runningSession.run_status, 'running');
      assert.equal(runningSession.external_session_id, 'feature-autorun-runtime-1');

      if (control.releaseRun) {
        control.releaseRun();
      }
      await flushMicrotasks();

      const completedSession = getSession(featureLead.id);
      assert.ok(completedSession);
      assert.equal(completedSession.run_status, 'idle');
      assert.equal(completedSession.last_run_summary, 'child auto-run completed');
      assert.equal(completedSession.external_session_id, 'feature-autorun-runtime-1');
    } finally {
      registerChildSessionAutoRunExecutor(null);
    }
  });
});
