import assert from 'node:assert/strict';
import test from 'node:test';

import type { OrchestratorSession } from './orchestrator.service.js';
import { buildOrchestratorBootstrapPrompt } from './orchestrator.service.js';
import { featureLeadStartupMessage, workerStartupMessage } from './prompts.js';

function createBootstrapSession(overrides: Partial<OrchestratorSession> = {}): OrchestratorSession {
  return {
    id: 'session-1',
    project_id: 'project-1',
    parent_id: null,
    provider: 'codex',
    model: 'gpt-5.4',
    type: 'feature_lead',
    title: '需求拆分',
    interaction_mode: 'conversational',
    lifecycle_status: 'active',
    run_status: 'queued',
    runtime_session_id: null,
    system_prompt: 'SYSTEM_BACKGROUND',
    role_prompt: 'ROLE_PROMPT',
    project_knowledge_snapshot: '',
    goal_and_constraints: '查询 session 状态树',
    workspace_path: null,
    auto_run: 1,
    summary_text: '',
    last_run_summary: '',
    last_error_summary: '',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
    ...overrides,
  };
}

test('feature lead startup message surfaces the requirement summary first', () => {
  const startupMessage = featureLeadStartupMessage('查询 session 状态树', '');

  assert.ok(startupMessage.startsWith('需求简介：查询 session 状态树'));
  assert.ok(!startupMessage.startsWith('你由 tech_lead 创建'));
  assert.ok(startupMessage.includes('目标：'));
  assert.ok(startupMessage.includes('约束：'));
});

test('worker startup message keeps the task spec as the first visible block', () => {
  const startupMessage = workerStartupMessage({
    title: '修复 bootstrap 顺序',
    objective: '让任务摘要先于背景约束展示',
    scope: '仅调整 orchestrator 启动消息组织',
    constraints: '不要改动角色体系',
    input_context: '来自 feature_lead 的任务单',
    expected_output: '代码修改与测试结果',
    acceptance_criteria: '首行是任务单而不是角色定义',
  });

  assert.ok(startupMessage.startsWith('任务单：'));
  assert.ok(startupMessage.includes('标题：修复 bootstrap 顺序'));
  assert.ok(startupMessage.includes('让任务摘要先于背景约束展示'));
  assert.ok(!startupMessage.includes('执行要求：'));
});

test('child session bootstrap keeps startup payload ahead of system background', () => {
  const featureLeadStartup = featureLeadStartupMessage('查询 session 状态树', '');
  const featureLeadBootstrap = buildOrchestratorBootstrapPrompt(
    createBootstrapSession({ type: 'feature_lead' }),
    '',
    featureLeadStartup,
  );

  assert.ok(featureLeadBootstrap.indexOf(featureLeadStartup) < featureLeadBootstrap.indexOf('SYSTEM_BACKGROUND'));

  const workerStartup = workerStartupMessage({
    title: '修复 bootstrap 顺序',
    objective: '让任务摘要先于背景约束展示',
    scope: '仅调整 orchestrator 启动消息组织',
    constraints: '不要改动角色体系',
    input_context: '来自 feature_lead 的任务单',
    expected_output: '代码修改与测试结果',
    acceptance_criteria: '首行是任务单而不是角色定义',
  });
  const workerBootstrap = buildOrchestratorBootstrapPrompt(
    createBootstrapSession({ type: 'worker' }),
    '',
    workerStartup,
  );

  assert.ok(workerBootstrap.indexOf(workerStartup) < workerBootstrap.indexOf('SYSTEM_BACKGROUND'));
  assert.ok(workerBootstrap.startsWith('<orchestrator_bootstrap>'));
});
