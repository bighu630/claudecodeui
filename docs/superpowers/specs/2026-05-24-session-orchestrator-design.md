# Session Orchestrator — V1 设计规格

> 基于 CodeAgent UI 二次开发，引入多角色 Session 编排能力。Provider 无关，支持 Claude / Cursor / Codex / Gemini 全部底层 AI。

**目标：** 在 CodeAgent UI 现有 UI 骨架上，加入 session 角色体系、层级树、状态机、自动派生和受控对话能力。

**技术栈：** React + Express + SQLite + WebSocket + 多 Provider SDK/CLI

**约束：** 不推倒现有 UI 布局，不破坏现有功能（文件树、Git、终端、MCP），不存完整聊天历史。

---

## 一、系统定位

本改造将 CodeAgent UI 从一个"多 provider 通用 AI chat 界面"升级为**项目级多 Session 编排工作台**。

| 新增能力 | 说明 |
|---------|------|
| Session 角色 | tech_lead / feature_lead / worker / ops |
| 层级树 | project → 根 session → 子 session → worker |
| 自动派生 | AI 对话驱动创建子 session，非手动 |
| 状态机 | lifecycle_status + run_status 双字段 |
| 受控对话 | worker 不可对话，只吃任务单 |
| Prompt 注入 | 4 段固定上下文（系统/角色/知识/目标），provider 无关 |
| Provider 无关 | 所有改动在 orchestration 层，不绑定具体 AI |

---

## 二、四类 Session 角色

### tech_lead（技术主管）
- 根 session，每项目固定 1 个
- 可对话，长期存在
- 职责：接收需求、架构决策、创建 feature_lead
- 不可创建 worker

### feature_lead（功能小组长）
- 由 tech_lead 通过对话自动创建
- 可对话，长期存在
- 创建后自动运行
- 职责：制定方案、创建 worker、验收结果
- 不可创建新的 feature_lead

### worker（执行者）
- 由 feature_lead 通过对话自动创建
- 不可对话，一次性，运行时展示
- 创建后自动运行
- 唯一输入：结构化任务单
- 完成后折叠/归档

### ops（运维）
- 根 session，每项目固定 1 个
- 可对话，长期存在
- 职责：运维/中间件/MCP/部署建议
- 不可创建任何子 session

---

## 三、状态机

### lifecycle_status
```
active → completed → archived (仅 worker)
active → failed
```

### run_status
```
idle → queued → running → idle (正常完成)
idle → queued → running → blocked (缺信息)
idle → waiting_input (仅 conversational)
```

### 角色默认值

| 角色 | auto_run | interaction_mode | 初始 lifecycle | 初始 run |
|------|----------|-----------------|---------------|---------|
| tech_lead | false | conversational | active | idle |
| feature_lead | true | conversational | active | queued |
| worker | true | managed | active | queued |
| ops | false | conversational | active | idle |

---

## 四、数据模型扩展

在现有 SQLite 数据库上新增以下表和字段。

### 4.1 新建表：orchestrator_sessions

```
id              TEXT PRIMARY KEY
project_id      TEXT NOT NULL
parent_id       TEXT          -- null for root sessions
provider        TEXT NOT NULL -- claude|cursor|codex|gemini
type            TEXT NOT NULL -- tech_lead|feature_lead|worker|ops
title           TEXT NOT NULL
interaction_mode TEXT NOT NULL -- conversational|managed
lifecycle_status TEXT NOT NULL -- active|completed|failed|archived
run_status      TEXT NOT NULL -- idle|queued|running|waiting_input|blocked
external_session_id TEXT     -- codex thread id / claude session id / etc
system_prompt   TEXT NOT NULL
role_prompt     TEXT NOT NULL
project_knowledge_snapshot TEXT
goal_and_constraints TEXT
workspace_path  TEXT
auto_run        INTEGER NOT NULL DEFAULT 0
summary_text    TEXT
last_run_summary TEXT
last_error_summary TEXT
created_at      TEXT NOT NULL
updated_at      TEXT NOT NULL
archived_at     TEXT
```

### 4.2 新建表：worker_task_specs

```
id                  TEXT PRIMARY KEY
worker_session_id   TEXT NOT NULL UNIQUE
title               TEXT NOT NULL
objective           TEXT NOT NULL
scope               TEXT NOT NULL
constraints         TEXT NOT NULL
input_context       TEXT NOT NULL
expected_output     TEXT NOT NULL
acceptance_criteria TEXT NOT NULL
created_by_session_id TEXT NOT NULL
created_at          TEXT NOT NULL
```

### 4.3 新建表：session_events

```
id          TEXT PRIMARY KEY
session_id  TEXT NOT NULL
run_id      TEXT
event_type  TEXT NOT NULL -- session_created|run_queued|run_started|run_finished|status_changed|child_session_created|task_spec_created|summary_updated|error_recorded|archived
payload_json TEXT
created_at  TEXT NOT NULL
```

### 4.4 新建表：session_artifacts

```
id            TEXT PRIMARY KEY
session_id    TEXT NOT NULL
artifact_type TEXT NOT NULL -- solution_plan|acceptance_note|test_note|run_result
title         TEXT NOT NULL
content       TEXT NOT NULL
created_at    TEXT NOT NULL
```

### 4.5 新建表：project_knowledge

```
id          TEXT PRIMARY KEY
project_id  TEXT NOT NULL UNIQUE
content     TEXT NOT NULL
created_at  TEXT NOT NULL
updated_at  TEXT NOT NULL
```

---

## 五、Prompt 注入体系

每个 session 启动时，无论底层使用哪个 provider，统一注入 4 段上下文，顺序固定：

```
1. 系统基础 prompt（全局固定）
2. 角色 prompt（按 type 选择）
3. 项目知识摘要（来自 project_knowledge 快照）
4. 当前 session 目标与约束（来自 goal_and_constraints 字段）
```

### 5.1 系统基础 prompt

```
你正在一个项目级多 Session 编排系统中工作。

行为规则：
1. 你属于某个明确的 session 角色，只能在该角色职责范围内工作。
2. 你不能假设自己拥有其它 session 的权限。
3. 你必须以工程任务为中心，输出清晰、可执行、可验收的结果。
4. 如果当前 session 是 worker，须严格遵守任务单范围，不得扩展。
5. 信息不足以继续时，必须明确指出阻塞原因。
6. 需要拆分工作时，仅在当前角色允许的范围内提出。
7. 输出偏向工程实施，不做无边界讨论。
```

### 5.2 角色 prompt

**tech_lead：**
```
你是当前项目的技术主管。
职责：负责整体架构和技术选型；接收用户需求并拆分为功能目标；明确目标和约束；创建 feature_lead 进一步推进。
边界：可与用户对话；可创建 feature_lead；不能直接创建 worker；不能修改项目知识摘要。
输出偏好：优先输出结构清晰的需求拆分；创建 feature_lead 时明确任务边界。
```

**feature_lead：**
```
你是功能小组长，负责具体功能或 bug。
职责：理解细化上级目标；制定解决方案；拆分结构化任务单；创建 worker；汇总结果并验收。
边界：可与用户对话；可创建 worker；不能创建新 feature_lead；不能绕过任务单直接把 worker 当作自由对话代理。
输出偏好：先给方案再决定是否拆 worker；任务拆分明确边界清晰；验收输出简洁清楚。
```

**worker：**
```
你是执行型 worker。
职责：严格执行任务单；只围绕任务单目标工作；输出执行结果或阻塞原因。
边界：不能与用户自由对话；不能要求聊天补充任务；不能扩展任务范围；不能创建任何子 session；信息不足立即停止并标记阻塞。
输出偏好：结果导向，简洁可验收；优先说明是否完成及原因；阻塞时指出缺失信息。
```

**ops：**
```
你是项目运维支持 session。
职责：接收部署/数据库/Redis/MCP/中间件等信息；对运维问题给出建议；执行运维相关任务；帮助建立稳定环境操作方式。
边界：可与用户对话；可执行任务；不能创建任何子 session；不能修改项目知识摘要。
输出偏好：清晰可执行的环境建议；明确前置条件和风险；不做功能实现拆分。
```

---

## 六、UI 改造

### 6.1 保留部分
- 侧栏 + 主内容基本布局
- 文件树、Git 面板、终端、MCP 配置
- ChatInterface 核心消息渲染
- WebSocket 实时通信

### 6.2 侧栏改造
- session 列表 → 层级树（project → tech_lead/ops → feature_lead → worker）
- 每个节点显示：title、type 图标、run_status 颜色指示
- 已完成 worker 默认折叠
- worker 节点不显示对话入口
- 不提供手动创建 session 按钮（全部 AI 驱动）

### 6.3 主内容改造
- ChatInterface：`interaction_mode === 'managed'` 时隐藏输入框，显示"此 session 不接受手动输入"
- 新增 SessionPanel tab：显示 session summary + 只读 config
- worker 选中时额外显示任务单卡片

### 6.4 Session Summary 面板
展示字段：title、type、provider、lifecycle_status、run_status、external_session_id、goal、summary_text、last_run_summary

---

## 七、后端改造

### 7.1 orchestrator.js（新增）
核心职责：
- 项目初始化时自动创建 tech_lead + ops
- 管理 session 创建/派生/状态切换
- worker 完成后回写摘要到父 feature_lead
- 校验派生规则

### 7.2 routes/sessions.js（新增）
```
GET    /api/orchestrator/projects/:projectId/tree    — 获取 session 树
POST   /api/orchestrator/sessions                     — 创建 session（AI 驱动调用）
PATCH  /api/orchestrator/sessions/:id/status          — 更新状态
POST   /api/orchestrator/sessions/:id/archive         — 归档 worker
GET    /api/orchestrator/sessions/:id                  — 获取 session 详情
POST   /api/orchestrator/sessions/:id/task-spec        — 创建 worker 任务单
```

### 7.3 Provider 集成改造
在现有 `queryCodex` / `queryClaudeSDK` / `spawnCursor` / `spawnGemini` 的调用入口前，加入统一的前置处理：

```
1. 从 orchestrator_sessions 读取 session 配置
2. 拼装 4 段 prompt → 完整 system instruction
3. 传入 provider 的 query 函数
4. 捕获 external_session_id 回写
5. 监听完成/失败事件更新状态
```

### 7.4 数据库迁移
DB init 时自动执行 migration，创建新表。

---

## 八、Session 生命周期流程

### 项目初始化
1. 用户创建项目 → 系统创建 tech_lead + ops
2. 生成 external_session_id（各 provider 各自创建）
3. lifecycle_status = active, run_status = idle

### feature_lead 创建
1. tech_lead 对话中决定创建
2. 系统调用 POST /api/orchestrator/sessions { type: feature_lead, parent_id, ... }
3. 创建 orchestrator_sessions 记录 + provider session
4. feature_lead.run_status = queued → 自动启动 → running
5. 首轮输入包含上级指令模板

### worker 创建
1. feature_lead 对话中形成任务单并决定创建
2. 系统校验任务单完整性
3. 创建 orchestrator_sessions 记录 + provider session + task_spec
4. worker.run_status = queued → 自动启动 → running
5. worker 不可对话，前端隐藏输入框

### worker 完成
1. run_status = idle, lifecycle_status = completed
2. 回写摘要到父 feature_lead
3. 侧栏折叠显示
4. 用户可手动归档

---

## 九、禁止事项

- 不推倒现有 UI 布局重写
- 不删除文件树、Git、终端、MCP 功能
- 不存储完整聊天历史
- 不提供手动创建 session 的 UI 按钮
- 不跨项目共享 session
- 不允许 worker 接收用户输入
- 不允许越级创建子 session
- V1 不实现 QC session
- V1 不实现项目知识摘要在线编辑
