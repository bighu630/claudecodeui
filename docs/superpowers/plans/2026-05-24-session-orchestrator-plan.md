# Session Orchestrator V1 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 CodeAgent UI 现有 UI 骨架上加入多角色 session 编排能力——层级树、4 种角色、状态机、自动派生、受控对话、provider 无关的 prompt 注入。

**架构：** 保留现有 React + Express + SQLite + WebSocket 架构。新增 orchestrator 模块管理 session 生命周期，前端侧栏改 session 平铺列表为层级树，主内容区根据 `interaction_mode` 控制对话权限。

**技术栈：** React 18 + TypeScript, Express.js, SQLite (better-sqlite3), WebSocket, multiple AI providers

---

## 文件结构

### 新增文件

| 文件 | 职责 |
|------|------|
| `server/modules/orchestrator/orchestrator.service.ts` | Session 生命周期管理：创建、派生、状态切换、worker 回写 |
| `server/modules/orchestrator/orchestrator.routes.ts` | REST API：session 树、创建、状态更新、归档、任务单 |
| `server/modules/orchestrator/prompts.ts` | 4 段 prompt 模板 + 按角色拼装函数 |
| `server/modules/orchestrator/index.ts` | 导出汇总 |
| `src/hooks/useSessionTree.ts` | 前端 hook：从后端拉 session 树，管理本地状态 |
| `src/components/sidebar/view/subcomponents/SidebarSessionTree.tsx` | 递归 session 树组件 |
| `src/components/main-content/view/subcomponents/SessionPanel.tsx` | Session Summary / Config 面板 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `server/modules/database/schema.ts` | 新增 5 张表的 DDL |
| `server/modules/database/migrations.ts` | 新增 migration 步骤 |
| `server/index.js` | 注册 orchestrator 路由 |
| `server/openai-codex.js` | 启动前注入 prompt，回写 external_session_id |
| `server/claude-sdk.js` | 同理 |
| `server/cursor-cli.js` | 同理 |
| `server/gemini-cli.js` | 同理 |
| `src/types/app.ts` | 新增 SessionType、OrchestratorSession 等类型 |
| `src/components/sidebar/view/Sidebar.tsx` | 传入 tree 数据 |
| `src/components/sidebar/view/subcomponents/SidebarProjectList.tsx` | 用 tree 替换平铺 session 列表 |
| `src/components/chat/view/ChatInterface.tsx` | 加入 interaction_mode 判断 |
| `src/components/main-content/view/MainContent.tsx` | 加入 SessionPanel tab |
| `src/hooks/useProjectsState.ts` | 拉取 tree 数据 |

---

### 任务 1：数据库 Schema 扩展

**文件：**
- 修改：`server/modules/database/schema.ts`
- 修改：`server/modules/database/migrations.ts`

- [ ] **步骤 1：在 schema.ts 末尾添加 5 张新表的 DDL**

在 `server/modules/database/schema.ts` 末尾（`INIT_SCHEMA_SQL` 之后）添加：

```typescript
export const ORCHESTRATOR_SESSIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS orchestrator_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    parent_id TEXT,
    provider TEXT NOT NULL DEFAULT 'codex',
    type TEXT NOT NULL CHECK(type IN ('tech_lead', 'feature_lead', 'worker', 'ops')),
    title TEXT NOT NULL,
    interaction_mode TEXT NOT NULL DEFAULT 'conversational' CHECK(interaction_mode IN ('conversational', 'managed')),
    lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle_status IN ('active', 'completed', 'failed', 'archived')),
    run_status TEXT NOT NULL DEFAULT 'idle' CHECK(run_status IN ('idle', 'queued', 'running', 'waiting_input', 'blocked')),
    external_session_id TEXT,
    system_prompt TEXT NOT NULL DEFAULT '',
    role_prompt TEXT NOT NULL DEFAULT '',
    project_knowledge_snapshot TEXT DEFAULT '',
    goal_and_constraints TEXT DEFAULT '',
    workspace_path TEXT,
    auto_run INTEGER NOT NULL DEFAULT 0,
    summary_text TEXT DEFAULT '',
    last_run_summary TEXT DEFAULT '',
    last_error_summary TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);
`;

export const WORKER_TASK_SPECS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS worker_task_specs (
    id TEXT PRIMARY KEY NOT NULL,
    worker_session_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    objective TEXT NOT NULL,
    scope TEXT NOT NULL,
    constraints TEXT NOT NULL,
    input_context TEXT NOT NULL,
    expected_output TEXT NOT NULL,
    acceptance_criteria TEXT NOT NULL,
    created_by_session_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (worker_session_id) REFERENCES orchestrator_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by_session_id) REFERENCES orchestrator_sessions(id)
);
`;

export const SESSION_EVENTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS session_events (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    run_id TEXT,
    event_type TEXT NOT NULL CHECK(event_type IN (
        'session_created', 'run_queued', 'run_started', 'run_finished',
        'status_changed', 'child_session_created', 'task_spec_created',
        'summary_updated', 'error_recorded', 'archived'
    )),
    payload_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES orchestrator_sessions(id) ON DELETE CASCADE
);
`;

export const SESSION_ARTIFACTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS session_artifacts (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    artifact_type TEXT NOT NULL CHECK(artifact_type IN ('solution_plan', 'acceptance_note', 'test_note', 'run_result')),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES orchestrator_sessions(id) ON DELETE CASCADE
);
`;

export const PROJECT_KNOWLEDGE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS project_knowledge (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);
`;
```

- [ ] **步骤 2：在 migrations.ts 末尾的 runMigrations 函数中添加新表初始化**

在 `server/modules/database/migrations.ts` 顶部导入新常量，在 `runMigrations` 函数末尾（`LAST_SCANNED_AT_SQL` 之后）添加：

```typescript
import {
  // ... existing imports
  ORCHESTRATOR_SESSIONS_TABLE_SQL,
  WORKER_TASK_SPECS_TABLE_SQL,
  SESSION_EVENTS_TABLE_SQL,
  SESSION_ARTIFACTS_TABLE_SQL,
  PROJECT_KNOWLEDGE_TABLE_SQL,
} from '@/modules/database/schema.js';
```

在 `runMigrations` 函数末尾（`db.exec(LAST_SCANNED_AT_SQL)` 之后，`console.log` 之前）添加：

```typescript
    // ── Orchestrator tables (V1) ──
    db.exec(ORCHESTRATOR_SESSIONS_TABLE_SQL);
    db.exec('CREATE INDEX IF NOT EXISTS idx_orch_sessions_project ON orchestrator_sessions(project_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_orch_sessions_parent ON orchestrator_sessions(parent_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_orch_sessions_type ON orchestrator_sessions(type)');

    db.exec(WORKER_TASK_SPECS_TABLE_SQL);
    db.exec('CREATE INDEX IF NOT EXISTS idx_task_specs_worker ON worker_task_specs(worker_session_id)');

    db.exec(SESSION_EVENTS_TABLE_SQL);
    db.exec('CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id)');

    db.exec(SESSION_ARTIFACTS_TABLE_SQL);
    db.exec('CREATE INDEX IF NOT EXISTS idx_artifacts_session ON session_artifacts(session_id)');

    db.exec(PROJECT_KNOWLEDGE_TABLE_SQL);
    db.exec('CREATE INDEX IF NOT EXISTS idx_project_knowledge_project ON project_knowledge(project_id)');
```

- [ ] **步骤 3：验证数据库**

```bash
# 重启服务后检查 SQLite 表是否创建成功
cd /data/code/ai_agent/claudecodeui && npm run dev 2>&1 &
sleep 3
# 检查服务日志中是否有 "Database migrations completed successfully"
# 然后 kill 进程
kill %1
```

---

### 任务 2：Prompt 模板模块

**文件：**
- 创建：`server/modules/orchestrator/prompts.ts`

- [ ] **步骤 1：创建 prompts.ts**

```typescript
// ─── System base prompt (all sessions share this) ───
export const SYSTEM_BASE_PROMPT = `你正在一个项目级多 Session 编排系统中工作。

行为规则：
1. 你属于某个明确的 session 角色，只能在该角色职责范围内工作。
2. 你不能假设自己拥有其它 session 的权限。
3. 你必须以工程任务为中心，输出清晰、可执行、可验收的结果。
4. 如果当前 session 是 worker，须严格遵守任务单范围，不得扩展。
5. 信息不足以继续时，必须明确指出阻塞原因，而不是编造上下文。
6. 需要拆分工作时，仅在当前角色允许的范围内提出建议，不得假设自己可以任意创建其它角色。
7. 输出偏向工程实施，不做无边界讨论。`;

// ─── Role-specific prompts ───
export const TECH_LEAD_PROMPT = `你是当前项目的技术主管。

职责：
1. 负责整体架构和技术选型。
2. 接收用户提出的需求、功能或问题。
3. 将需求拆分为可以交给功能小组长处理的目标。
4. 明确目标、范围和约束。
5. 为后续功能小组长提供清晰的上级指令。

边界：
1. 你可以与用户对话。
2. 你可以推动形成 feature_lead。
3. 你不能直接创建 worker。
4. 你不能修改项目知识摘要。
5. 你不负责以自由执行者身份处理所有细节实现。

输出偏好：
1. 优先输出结构清晰的需求拆分。
2. 明确说明目标、范围、风险和约束。
3. 需要创建 feature_lead 时，尽量把任务边界写清楚。`;

export const FEATURE_LEAD_PROMPT = `你是某个功能或 bug 的功能小组长。

职责：
1. 理解并细化上级交付的目标。
2. 为该功能或 bug 制定解决方案。
3. 在需要具体执行时，拆分出结构化任务单。
4. 基于任务单创建 worker。
5. 等待 worker 执行结果。
6. 汇总 worker 结果，给出验收结论和测试说明。

边界：
1. 你可以与用户对话。
2. 你可以创建 worker。
3. 你不能创建新的 feature_lead。
4. 你不能绕过任务单直接把 worker 作为自由对话代理。
5. 你不能修改项目知识摘要。

输出偏好：
1. 先给出方案，再决定是否拆 worker。
2. 任务拆分必须明确、边界清晰。
3. 验收输出必须简洁清楚。
4. 如果 worker 结果不足以验收，明确指出缺口。`;

export const WORKER_PROMPT = `你是执行型 worker。

职责：
1. 严格执行当前任务单。
2. 只围绕任务单目标工作。
3. 输出执行结果、阻塞点或失败原因。
4. 为上级 feature_lead 提供可复用的完成摘要。

边界：
1. 你不能与用户自由对话。
2. 你不能要求通过聊天补充任务。
3. 你不能扩展任务范围。
4. 你不能创建任何子 session。
5. 如果信息不足，你必须停止并标记为阻塞。

输出偏好：
1. 结果导向。
2. 简洁、明确、可验收。
3. 优先说明是否完成、为什么完成或为什么失败。
4. 如有阻塞，明确指出缺失信息。`;

export const OPS_PROMPT = `你是当前项目的运维支持 session。

职责：
1. 接收用户关于部署、数据库、Redis、MCP、中间件和环境的信息。
2. 对项目运维相关问题给出建议。
3. 在需要时执行与运维相关的任务。
4. 帮助当前项目建立稳定的环境操作方式。

边界：
1. 你可以与用户对话。
2. 你可以执行任务。
3. 你不能创建任何子 session。
4. 你不能修改项目知识摘要。

输出偏好：
1. 优先给出清晰可执行的环境建议。
2. 尽量明确前置条件、风险和操作范围。
3. 不做与当前运维主题无关的功能实现拆分。`;

// ─── Prompt resolution ───
export type SessionType = 'tech_lead' | 'feature_lead' | 'worker' | 'ops';

export function getRolePrompt(type: SessionType): string {
  switch (type) {
    case 'tech_lead': return TECH_LEAD_PROMPT;
    case 'feature_lead': return FEATURE_LEAD_PROMPT;
    case 'worker': return WORKER_PROMPT;
    case 'ops': return OPS_PROMPT;
  }
}

// ─── Compose full system instruction ───
export function composePrompt(
  type: SessionType,
  projectKnowledge: string,
  goalAndConstraints: string,
): string {
  const rolePrompt = getRolePrompt(type);
  return [
    SYSTEM_BASE_PROMPT,
    '',
    '─── 角色定义 ───',
    rolePrompt,
    '',
    '─── 项目知识 ───',
    projectKnowledge || '(无)',
    '',
    '─── 当前目标与约束 ───',
    goalAndConstraints || '(无)',
  ].join('\n');
}

// ─── Feature lead startup message template ───
export function featureLeadStartupMessage(goal: string, constraints: string): string {
  return `上级指令：
你由技术主管创建，负责处理以下功能或问题。

目标：
${goal}

约束：
${constraints}

要求：
1. 先形成解决方案。
2. 如需执行具体实现，拆分出结构化任务单并创建 worker。
3. 汇总 worker 结果后给出验收结论和测试说明。
4. 不得跳过任务拆分直接把 worker 当作自由聊天对象。`;
}

// ─── Worker startup message template ───
export function workerStartupMessage(taskSpec: {
  title: string;
  objective: string;
  scope: string;
  constraints: string;
  input_context: string;
  expected_output: string;
  acceptance_criteria: string;
}): string {
  return `任务单：
标题：${taskSpec.title}

目标：
${taskSpec.objective}

范围：
${taskSpec.scope}

约束：
${taskSpec.constraints}

输入上下文：
${taskSpec.input_context}

预期产出：
${taskSpec.expected_output}

验收标准：
${taskSpec.acceptance_criteria}

执行要求：
1. 严格围绕任务单执行。
2. 不得自行扩展任务范围。
3. 若信息不足，立即停止并标记为 blocked。
4. 完成后输出简洁结果摘要。`;
}
```

---

### 任务 3：Orchestrator 服务

**文件：**
- 创建：`server/modules/orchestrator/orchestrator.service.ts`

- [ ] **步骤 1：创建 orchestrator.service.ts**

```typescript
import { v4 as uuidv4 } from 'uuid';
import { getConnection } from '@/modules/database/connection.js';
import type Database from 'better-sqlite3';
import { composePrompt, featureLeadStartupMessage, workerStartupMessage, getRolePrompt } from './prompts.js';
import type { SessionType } from './prompts.js';

// Re-export SessionType for consumers
export type { SessionType };

export interface OrchestratorSession {
  id: string;
  project_id: string;
  parent_id: string | null;
  provider: string;
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

// ─── Session type defaults ───
const SESSION_DEFAULTS: Record<SessionType, { interaction_mode: string; auto_run: number; run_status: string }> = {
  tech_lead: { interaction_mode: 'conversational', auto_run: 0, run_status: 'idle' },
  feature_lead: { interaction_mode: 'conversational', auto_run: 1, run_status: 'queued' },
  worker: { interaction_mode: 'managed', auto_run: 1, run_status: 'queued' },
  ops: { interaction_mode: 'conversational', auto_run: 0, run_status: 'idle' },
};

// ─── Derivation rules ───
const DERIVATION_RULES: Record<SessionType, SessionType[]> = {
  tech_lead: ['feature_lead'],
  feature_lead: ['worker'],
  worker: [],
  ops: [],
};

export function canCreateChild(parentType: SessionType, childType: SessionType): boolean {
  return DERIVATION_RULES[parentType]?.includes(childType) ?? false;
}

function getDb(): Database.Database {
  return getConnection();
}

// ─── CRUD ───

export function createSession(params: {
  project_id: string;
  parent_id: string | null;
  provider: string;
  type: SessionType;
  title: string;
  workspace_path?: string;
  goal_and_constraints?: string;
}): OrchestratorSession {
  const db = getDb();
  const id = uuidv4();
  const defaults = SESSION_DEFAULTS[params.type];

  const rolePrompt = getRolePrompt(params.type);
  const knowledgeSnapshot = getProjectKnowledge(params.project_id);
  const composedSystemPrompt = composePrompt(params.type, knowledgeSnapshot, params.goal_and_constraints ?? '');

  const stmt = db.prepare(`
    INSERT INTO orchestrator_sessions (
      id, project_id, parent_id, provider, type, title,
      interaction_mode, lifecycle_status, run_status,
      system_prompt, role_prompt, project_knowledge_snapshot,
      goal_and_constraints, workspace_path, auto_run
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id, params.project_id, params.parent_id, params.provider, params.type, params.title,
    defaults.interaction_mode, defaults.run_status,
    composedSystemPrompt, rolePrompt, knowledgeSnapshot,
    params.goal_and_constraints ?? '', params.workspace_path ?? null, defaults.auto_run,
  );

  // Record event
  insertEvent(db, id, null, 'session_created', { type: params.type, parent_id: params.parent_id });

  // If has parent, record child_session_created event
  if (params.parent_id) {
    insertEvent(db, params.parent_id, null, 'child_session_created', { child_id: id, child_type: params.type });
  }

  return getSession(id)!;
}

export function getSession(id: string): OrchestratorSession | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM orchestrator_sessions WHERE id = ?').get(id) as OrchestratorSession | undefined;
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
    'SELECT * FROM orchestrator_sessions WHERE project_id = ? AND lifecycle_status != \'archived\' ORDER BY created_at ASC'
  ).all(project_id) as OrchestratorSession[];

  return buildTree(rows, null);
}

function buildTree(rows: OrchestratorSession[], parentId: string | null): SessionTreeNode[] {
  return rows
    .filter(r => r.parent_id === parentId)
    .map(r => ({
      ...r,
      children: buildTree(rows, r.id),
    }));
}

// ─── Project knowledge ───

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

// ─── Task specs ───

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

// ─── Worker completion callback ───

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

  // Write back to parent feature_lead
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

// ─── Events ───

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

// ─── Provider session ID binding ───

export function bindExternalSessionId(localSessionId: string, externalSessionId: string): void {
  updateSessionStatus(localSessionId, { external_session_id: externalSessionId });
}
```

- [ ] **步骤 2：检查 uuid 依赖**

```bash
cd /data/code/ai_agent/claudecodeui && grep '"uuid"' package.json
```

如果不存在，安装：

```bash
cd /data/code/ai_agent/claudecodeui && npm install uuid && npm install -D @types/uuid
```

---

### 任务 4：Orchestrator 路由

**文件：**
- 创建：`server/modules/orchestrator/orchestrator.routes.ts`
- 修改：`server/index.js`

- [ ] **步骤 1：创建路由文件**

```typescript
import { Router } from 'express';
import * as orch from './orchestrator.service.js';
import { featureLeadStartupMessage, getRolePrompt, composePrompt } from './prompts.js';
import type { SessionType } from './prompts.js';

const router = Router();

// GET project session tree
router.get('/projects/:projectId/tree', (req, res) => {
  try {
    const tree = orch.getSessionTree(req.params.projectId);
    res.json({ tree });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET single session
router.get('/sessions/:id', (req, res) => {
  try {
    const session = orch.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const taskSpec = session.type === 'worker' ? orch.getTaskSpec(req.params.id) : null;
    const events = orch.getSessionEvents(req.params.id);
    res.json({ session, taskSpec, events });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST create session (AI-driven)
router.post('/sessions', (req, res) => {
  try {
    const { project_id, parent_id, provider, type, title, workspace_path, goal_and_constraints } = req.body;

    if (!project_id || !type || !title) {
      return res.status(400).json({ error: 'Missing required fields: project_id, type, title' });
    }

    // Validate derivation if parent exists
    if (parent_id) {
      const parent = orch.getSession(parent_id);
      if (!parent) return res.status(404).json({ error: 'Parent session not found' });
      if (!orch.canCreateChild(parent.type as SessionType, type as SessionType)) {
        return res.status(403).json({
          error: `Session type '${parent.type}' cannot create child of type '${type}'`,
        });
      }
    }

    const session = orch.createSession({
      project_id,
      parent_id: parent_id ?? null,
      provider: provider ?? 'codex',
      type: type as SessionType,
      title,
      workspace_path,
      goal_and_constraints,
    });

    // Generate startup message for auto-run types
    let startupMessage: string | null = null;
    if (type === 'feature_lead' && parent_id) {
      const parent = orch.getSession(parent_id);
      startupMessage = featureLeadStartupMessage(
        goal_and_constraints ?? session.goal_and_constraints,
        '',
      );
    }

    res.status(201).json({ session, startupMessage });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH update session status
router.patch('/sessions/:id/status', (req, res) => {
  try {
    const { lifecycle_status, run_status, external_session_id, summary_text, last_run_summary, last_error_summary } = req.body;
    orch.updateSessionStatus(req.params.id, {
      lifecycle_status,
      run_status,
      external_session_id,
      summary_text,
      last_run_summary,
      last_error_summary,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST archive worker
router.post('/sessions/:id/archive', (req, res) => {
  try {
    orch.archiveWorker(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST create task spec for worker
router.post('/sessions/:id/task-spec', (req, res) => {
  try {
    const session = orch.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.type !== 'worker') return res.status(400).json({ error: 'Task specs only valid for worker sessions' });

    const { title, objective, scope, constraints, input_context, expected_output, acceptance_criteria, created_by_session_id } = req.body;
    const requiredFields: Record<string, string | undefined> = { title, objective, scope, constraints, input_context, expected_output, acceptance_criteria, created_by_session_id };
    const missing = Object.entries(requiredFields).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    const spec = orch.createTaskSpec({
      worker_session_id: req.params.id,
      title,
      objective,
      scope,
      constraints,
      input_context,
      expected_output,
      acceptance_criteria,
      created_by_session_id,
    });

    res.status(201).json({ taskSpec: spec });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST worker completed callback
router.post('/sessions/:id/worker-completed', (req, res) => {
  try {
    const { success, runSummary, errorSummary } = req.body;
    orch.onWorkerCompleted(req.params.id, success, runSummary, errorSummary);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET project knowledge
router.get('/projects/:projectId/knowledge', (req, res) => {
  try {
    const content = orch.getProjectKnowledge(req.params.projectId);
    res.json({ content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

- [ ] **步骤 2：创建 orchestrator/index.ts**

```typescript
export { default as orchestratorRoutes } from './orchestrator.routes.js';
export * from './orchestrator.service.js';
export * from './prompts.js';
```

- [ ] **步骤 3：在 server/index.js 注册路由**

在 `server/index.js` 中，找到其他路由注册的位置（约第 186 行 `app.use('/api/agent', agentRoutes)` 之后），添加：

```javascript
import { orchestratorRoutes } from './modules/orchestrator/orchestrator.routes.js';
// ... 在其他路由之后
app.use('/api/orchestrator', authenticateToken, orchestratorRoutes);
```

---

### 任务 5：项目初始化自动创建根 Session

**文件：**
- 修改：`server/modules/projects/` 中的项目创建逻辑
- 或修改：`server/index.js` 中项目初始化部分

- [ ] **步骤 1：找到项目创建 endpoint**

查找 `server/modules/projects/` 下的创建逻辑：

```bash
grep -rn "POST\|createProject\|addProject" /data/code/ai_agent/claudecodeui/server/modules/projects/
```

- [ ] **步骤 2：在项目创建成功后挂钩**

在项目创建成功后的代码中添加：

```typescript
import { createSession, ensureProjectKnowledge } from '@/modules/orchestrator/orchestrator.service.js';

// After project creation:
try {
  ensureProjectKnowledge(projectId, '');
  createSession({
    project_id: projectId,
    parent_id: null,
    provider: 'codex',
    type: 'tech_lead',
    title: '技术主管',
    workspace_path: projectPath,
    goal_and_constraints: '负责当前项目的整体架构和技术选型',
  });
  createSession({
    project_id: projectId,
    parent_id: null,
    provider: 'codex',
    type: 'ops',
    title: '运维',
    workspace_path: projectPath,
    goal_and_constraints: '负责运维支持、中间件接入、部署建议',
  });
} catch (e) {
  console.error('Failed to create root orchestrator sessions:', e);
}
```

---

### 任务 6：Provider 集成 — Prompt 注入

**文件：**
- 修改：`server/openai-codex.js`
- 修改：`server/claude-sdk.js`
- 修改：`server/cursor-cli.js`
- 修改：`server/gemini-cli.js`

- [ ] **步骤 1：修改 openai-codex.js**

在文件顶部导入 orchestrator：

```javascript
import { getSession, updateSessionStatus, onWorkerCompleted } from '../modules/orchestrator/orchestrator.service.js';
```

在 `queryCodex` 函数中，`thread.runStreamed(command)` 之前，注入 session 上下文。找到约第 253 行附近，修改为：

```javascript
    // Resolve orchestrator session context if available
    let resolvedCommand = command;
    if (options.orchestratorSessionId) {
      const orchSession = getSession(options.orchestratorSessionId);
      if (orchSession) {
        // Prepend system context to command
        resolvedCommand = `${orchSession.system_prompt}\n\n用户消息：\n${command}`;
        // Update status to running
        updateSessionStatus(options.orchestratorSessionId, { run_status: 'running' });
      }
    }

    // Execute with streaming (use resolvedCommand instead of command)
    const streamedTurn = await thread.runStreamed(resolvedCommand, {
      signal: abortController.signal
    });
```

在 `turn.completed` / 正常结束后，添加 worker 回写：

```javascript
    // After completion handling (around line 320)
    if (options.orchestratorSessionId) {
      updateSessionStatus(options.orchestratorSessionId, {
        run_status: 'idle',
        lifecycle_status: 'completed',
      });
    }
```

在 `turn.failed` / `catch` 错误块中，添加失败更新：

```javascript
    if (options.orchestratorSessionId) {
      updateSessionStatus(options.orchestratorSessionId, {
        run_status: 'idle',
        lifecycle_status: 'failed',
        last_error_summary: error?.message ?? 'Unknown error',
      });

      const orchSession = getSession(options.orchestratorSessionId);
      if (orchSession && orchSession.type === 'worker') {
        onWorkerCompleted(options.orchestratorSessionId, false, '', error?.message ?? 'Unknown error');
      }
    }
```

在 `thread.started` 事件中（约第 260 行），绑定 external_session_id：

```javascript
      if (event.type === 'thread.started') {
        const discoveredSessionId = event.thread_id || event.id || null;
        if (discoveredSessionId && options.orchestratorSessionId) {
          bindExternalSessionId(options.orchestratorSessionId, discoveredSessionId);
        }
        // ... rest of existing code
      }
```

- [ ] **步骤 2：同理修改 claude-sdk.js, cursor-cli.js, gemini-cli.js**

每处修改逻辑一致：启动前查 orchestrator session → 注入 system_prompt → 更新 run_status = running → 完成后更新 run_status = idle + 回调 onWorkerCompleted。

---

### 任务 7：前端类型定义

**文件：**
- 修改：`src/types/app.ts`

- [ ] **步骤 1：添加新类型**

在 `src/types/app.ts` 末尾追加：

```typescript
// ─── Orchestrator types ───

export type SessionType = 'tech_lead' | 'feature_lead' | 'worker' | 'ops';

export type LifecycleStatus = 'active' | 'completed' | 'failed' | 'archived';

export type RunStatus = 'idle' | 'queued' | 'running' | 'waiting_input' | 'blocked';

export type InteractionMode = 'conversational' | 'managed';

export interface OrchestratorSession {
  id: string;
  project_id: string;
  parent_id: string | null;
  provider: LLMProvider;
  type: SessionType;
  title: string;
  interaction_mode: InteractionMode;
  lifecycle_status: LifecycleStatus;
  run_status: RunStatus;
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

export interface SessionTreeResponse {
  tree: SessionTreeNode[];
}

export interface SessionDetailResponse {
  session: OrchestratorSession;
  taskSpec: WorkerTaskSpec | null;
  events: Array<{ id: string; event_type: string; payload_json: string; created_at: string }>;
}
```

---

### 任务 8：前端 session tree hook

**文件：**
- 创建：`src/hooks/useSessionTree.ts`

- [ ] **步骤 1：创建 hook**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '../utils/api';
import type { SessionTreeNode, SessionTreeResponse, OrchestratorSession, SessionDetailResponse } from '../types/app';

export function useSessionTree(projectId: string | null) {
  const [tree, setTree] = useState<SessionTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTree = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authenticatedFetch(`/api/orchestrator/projects/${encodeURIComponent(projectId)}/tree`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SessionTreeResponse = await res.json();
      setTree(data.tree);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  return { tree, loading, error, refresh: fetchTree };
}

export function useSessionDetail(sessionId: string | null) {
  const [session, setSession] = useState<OrchestratorSession | null>(null);
  const [taskSpec, setTaskSpec] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    authenticatedFetch(`/api/orchestrator/sessions/${encodeURIComponent(sessionId)}`)
      .then(res => res.json())
      .then((data: SessionDetailResponse) => {
        setSession(data.session);
        setTaskSpec(data.taskSpec as any);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sessionId]);

  return { session, taskSpec, loading };
}
```

---

### 任务 9：侧栏 Session 树组件

**文件：**
- 创建：`src/components/sidebar/view/subcomponents/SidebarSessionTree.tsx`
- 修改：`src/components/sidebar/view/subcomponents/SidebarProjectList.tsx`
- 修改：`src/components/sidebar/view/Sidebar.tsx`

- [ ] **步骤 1：创建 SidebarSessionTree 组件**

```tsx
import { ChevronDown, ChevronRight, Wrench, User, Users, Bot } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../../../lib/utils';
import type { SessionTreeNode, SessionType } from '../../../../types/app';

const ROLE_ICONS: Record<SessionType, typeof User> = {
  tech_lead: User,
  feature_lead: Users,
  worker: Bot,
  ops: Wrench,
};

const RUN_STATUS_COLORS: Record<string, string> = {
  idle: 'bg-gray-400',
  queued: 'bg-yellow-400',
  running: 'bg-green-400 animate-pulse',
  waiting_input: 'bg-blue-400',
  blocked: 'bg-red-400',
};

interface Props {
  nodes: SessionTreeNode[];
  selectedSessionId: string | null;
  onSelect: (session: SessionTreeNode) => void;
  level?: number;
}

export default function SidebarSessionTree({ nodes, selectedSessionId, onSelect, level = 0 }: Props) {
  return (
    <div className="space-y-0.5">
      {nodes.map(node => (
        <SessionTreeNodeItem
          key={node.id}
          node={node}
          selectedSessionId={selectedSessionId}
          onSelect={onSelect}
          level={level}
        />
      ))}
    </div>
  );
}

function SessionTreeNodeItem({ node, selectedSessionId, onSelect, level }: Props & { node: SessionTreeNode }) {
  const [expanded, setExpanded] = useState(node.type !== 'worker');
  const hasChildren = node.children.length > 0;
  const isSelected = selectedSessionId === node.id;
  const Icon = ROLE_ICONS[node.type] || Bot;

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-sm hover:bg-accent/50',
          isSelected && 'bg-accent text-accent-foreground',
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => {
          if (hasChildren) setExpanded(!expanded);
          onSelect(node);
        }}
      >
        {hasChildren ? (
          expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />
        ) : (
          <span className="w-3" />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate flex-1">{node.title}</span>
        <span className={cn('h-2 w-2 rounded-full shrink-0', RUN_STATUS_COLORS[node.run_status] || 'bg-gray-400')} />
      </div>
      {expanded && hasChildren && (
        <SidebarSessionTree
          nodes={node.children}
          selectedSessionId={selectedSessionId}
          onSelect={onSelect}
          level={level + 1}
        />
      )}
    </div>
  );
}
```

- [ ] **步骤 2：修改 SidebarProjectList，传入树数据**

在 `SidebarProjectList` 中，给每个展开的项目渲染 `SidebarSessionTree` 替代原来的平铺 session 列表。

需要新增 props：
```typescript
orchestratorTree: SessionTreeNode[];
onOrchestratorSessionSelect: (session: SessionTreeNode) => void;
```

在项目展开区域渲染：
```tsx
{isExpanded && project.orchestratorTree && (
  <SidebarSessionTree
    nodes={project.orchestratorTree}
    selectedSessionId={selectedSession?.id ?? null}
    onSelect={onOrchestratorSessionSelect}
  />
)}
```

---

### 任务 10：Worker 不可对话

**文件：**
- 修改：`src/components/chat/view/ChatInterface.tsx`

- [ ] **步骤 1：找到输入框组件并加判断**

在 `ChatInterface` 组件中，找到消息输入框的渲染位置，包裹条件：

```tsx
{selectedSession?.interaction_mode !== 'managed' ? (
  <ChatInput ... />
) : (
  <div className="flex items-center justify-center p-4 text-sm text-muted-foreground border-t">
    此 session 不接受手动输入（worker 模式）
  </div>
)}
```

同时对于 worker session，如果 taskSpec 存在，在消息列表上方额外渲染任务单卡片：

```tsx
{selectedSession?.type === 'worker' && taskSpec && (
  <div className="mx-4 mt-2 p-3 rounded border bg-muted/30 text-xs">
    <div className="font-semibold mb-1">任务单：{taskSpec.title}</div>
    <div className="text-muted-foreground">目标：{taskSpec.objective}</div>
    <div className="text-muted-foreground">范围：{taskSpec.scope}</div>
  </div>
)}
```

---

### 任务 11：Session Panel Tab

**文件：**
- 创建：`src/components/main-content/view/subcomponents/SessionPanel.tsx`
- 修改：`src/components/main-content/view/MainContent.tsx`

- [ ] **步骤 1：创建 SessionPanel 组件**

```tsx
import type { OrchestratorSession, WorkerTaskSpec } from '../../../types/app';

interface Props {
  session: OrchestratorSession | null;
  taskSpec: WorkerTaskSpec | null;
}

export default function SessionPanel({ session, taskSpec }: Props) {
  if (!session) {
    return <div className="p-4 text-muted-foreground text-sm">未选中 session</div>;
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* Summary */}
      <section>
        <h3 className="text-sm font-semibold mb-2">Session Summary</h3>
        <dl className="space-y-1 text-xs">
          <Row label="Title" value={session.title} />
          <Row label="Type" value={session.type} />
          <Row label="Provider" value={session.provider} />
          <Row label="Lifecycle" value={session.lifecycle_status} />
          <Row label="Run Status" value={session.run_status} />
          <Row label="Interaction" value={session.interaction_mode} />
          <Row label="External ID" value={session.external_session_id || '-'} />
          <Row label="Created" value={session.created_at} />
        </dl>
      </section>

      {/* Goal */}
      <section>
        <h3 className="text-sm font-semibold mb-1">Goal & Constraints</h3>
        <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap">{session.goal_and_constraints || '-'}</pre>
      </section>

      {/* Last run summary */}
      {session.last_run_summary && (
        <section>
          <h3 className="text-sm font-semibold mb-1">Last Run</h3>
          <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap">{session.last_run_summary}</pre>
        </section>
      )}

      {/* Error */}
      {session.last_error_summary && (
        <section>
          <h3 className="text-sm font-semibold mb-1 text-destructive">Last Error</h3>
          <pre className="text-xs bg-destructive/10 p-2 rounded whitespace-pre-wrap">{session.last_error_summary}</pre>
        </section>
      )}

      {/* Task Spec for worker */}
      {taskSpec && (
        <section>
          <h3 className="text-sm font-semibold mb-1">Task Spec</h3>
          <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap">
            {JSON.stringify(taskSpec, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
```

- [ ] **步骤 2：在 MainContent 中注册新 tab**

在 `MainContent.tsx` 中：
1. 导入 `SessionPanel`
2. 扩展 `AppTab` 类型或直接使用字符串 `'session-panel'`
3. 在 tab 渲染区域加入新 tab

---

### 任务 12：Integration Test

- [ ] **步骤 1：启动开发服务器验证**

```bash
cd /data/code/ai_agent/claudecodeui && npm run dev 2>&1 &
sleep 5
# 检查输出中是否有 "Database migrations completed successfully"
# 检查是否有编译错误
```

- [ ] **步骤 2：测试 API**

```bash
# 测试获取 session 树（需要先有项目）
curl -s http://localhost:3001/api/orchestrator/projects/<projectId>/tree | jq .

# 测试创建 session
curl -s -X POST http://localhost:3001/api/orchestrator/sessions \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"<id>","type":"feature_lead","title":"测试组长","provider":"codex"}' | jq .
```

- [ ] **步骤 3：检查前端无编译错误**

打开浏览器访问 `http://localhost:5173`，确认：
- 侧栏显示 session 树（替代原平铺列表）
- 节点有 type 图标和 run_status 圆点
- 点击 tech_lead / ops / feature_lead 可以正常聊天
- 选中 worker 时不显示输入框
- SessionPanel tab 显示 session 信息

---

### 任务 13：Commit

```bash
cd /data/code/ai_agent/claudecodeui
git add .
git commit -m "feat: add session orchestrator V1 with role-based session management"
```
