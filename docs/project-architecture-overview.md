# 项目架构总览

本文档面向需要快速理解 `claudecodeui` 当前工程结构的人，重点说明：

1. 这个项目现在的模块划分和主运行链路
2. 已接入的中间件、基础设施和外部 runtime
3. 最近由 `ivhu` 提交的“基于角色的 session 编排系统”改造内容
4. 当前架构下值得注意的边界、约束和后续扩展点

本文档基于仓库当前代码状态整理，关注“现状”和“代码责任边界”，不是产品介绍文档。

## 1. 项目定位

这个项目本质上是一个面向多种 AI coding agent runtime 的统一控制台，提供：

- Web UI
- 会话管理
- 文件/Git/命令/插件能力
- provider 适配层
- WebSocket 实时通信
- 本地 SQLite 持久化

目前支持的 provider/runtime：

- Claude
- Codex
- Cursor CLI
- Gemini CLI

从 README 和代码现状看，项目已经从早期“单 provider 会话 UI”演进为“多 provider + 项目级 session 编排平台”。

## 2. 技术栈与基础设施

### 前端

- React 18
- Vite
- TypeScript
- Tailwind CSS
- react-router-dom
- i18next
- xterm.js
- CodeMirror

### 后端

- Node.js
- Express
- ws
- better-sqlite3
- JWT 认证
- SSE（部分接口如 clone-progress）
- node-pty（shell/终端）

### 关键外部 SDK / 运行时

- `@anthropic-ai/claude-agent-sdk`
- `@openai/codex-sdk`
- 本地 Cursor CLI
- 本地 Gemini CLI

### 工程方式

- 单仓库，前后端同 repo
- 前端构建输出到 `dist/`
- 服务端构建输出到 `dist-server/`
- 服务端是整个系统的编排中枢

## 3. 目录级模块划分

### 3.1 服务端主干

服务端入口在 `server/index.js`，它负责：

- 初始化环境变量
- 创建 Express app 和 HTTP server
- 创建统一 WebSocket server
- 装配鉴权中间件
- 注册各类 REST route
- 初始化数据库
- 启动 provider session watcher
- 启动插件进程管理和通知能力

和入口直接相连的几条主干文件是：

- `server/index.js`
  - HTTP / WebSocket 总装配点
- `server/claude-sdk.js`
  - Claude runtime 接入与流式消息桥接
- `server/openai-codex.js`
  - Codex runtime 接入
- `server/cursor-cli.js`
  - Cursor CLI 启动、恢复、终止、orchestrator tool 桥接
- `server/gemini-cli.js`
  - Gemini CLI 接入
- `server/sessionManager.js`
  - shell/终端侧 session 维持

服务端按职责主要分为以下几块：

#### `server/modules/database`

职责：

- SQLite 连接与初始化
- schema 和 migration
- repository 层

当前重要表包括：

- `projects`
- `sessions`
- `project_role_model_configs`
- `orchestrator_sessions`
- `worker_task_specs`
- `session_events`
- `session_artifacts`
- `project_knowledge`
- `users`
- `api_keys`
- `user_credentials`
- `push_subscriptions`

这说明数据库已从“仅记录 provider session 元数据”扩展为“项目、用户、通知、编排会话、知识快照”的统一持久化层。

#### `server/modules/providers`

职责：

- 对 Claude/Codex/Cursor/Gemini 做统一 provider 抽象
- 统一 auth / MCP / skills / sessions / sessionSynchronizer 五个 facet
- 提供 provider 级 REST API
- 管理 provider 会话同步与历史读取

这是整个系统的“provider 适配层”。

它把不同 runtime 的差异收敛到统一接口上，前端和上层服务尽量只与统一接口交互。

当前 provider registry 位于 `server/modules/providers/provider.registry.ts`，由它把：

- `ClaudeProvider`
- `CodexProvider`
- `CursorProvider`
- `GeminiProvider`

统一注册成 `provider -> implementation` 的映射。

#### `server/modules/websocket`

职责：

- 统一 WebSocket 入口
- 路由三类连接：
  - `/ws`：聊天与会话流式消息
  - `/shell`：终端/PTY
  - `/plugin-ws/:pluginName`：插件透传

这是系统实时交互的通信网关。

#### `server/modules/projects`

职责：

- 项目创建/归档/恢复/星标
- 项目列表与 session 聚合查询
- clone 工作流
- 项目角色模型配置

这里已经不只是“目录列表”，而是项目级业务聚合层。

#### `server/modules/orchestrator`

职责：

- 维护项目级编排 session 树
- 管理角色、父子会话关系、状态、知识快照
- 生成角色 prompt
- 对 runtime session 和 orchestrator session 做绑定
- 提供树查询、session 详情、task spec、状态更新等 API

这是本轮架构演进的核心新增模块。

### 3.2 前端主干

前端主要位于 `src/components`、`src/hooks`、`src/stores`、`src/utils`。

按功能看，核心区域包括：

- `components/chat`：聊天界面、消息流、输入区、provider 状态
- `components/sidebar`：项目列表、session 树、角色配置入口
- `components/shell`：内置终端
- `components/file-tree` / `code-editor` / `git-panel`：IDE 侧边能力
- `components/mcp`：MCP server 管理
- `components/project-creation-wizard`：项目创建流程
- `components/project-role-config`：项目角色模型配置
- `components/main-content`：主视图拼装与 orchestrator SessionPanel

关键状态与 glue code：

- `src/stores/useSessionStore.ts`
  - 维护按 sessionId 分片的消息缓存
  - 合并服务端历史与 WebSocket 实时流
  - 解决 runtime session id 和 UI session id 之间的映射问题

- `src/hooks/useSessionTree.ts`
  - 拉取 orchestrator 树
  - 监听实时消息后刷新树

- `src/utils/sessionIdentity.ts`
  - 区分 orchestrator session 与 provider runtime session
  - 统一 route id / runtime id / orchestrator id 的识别逻辑

## 4. 系统运行链路

## 4.1 常规 provider 会话链路

1. 前端 ChatInterface 选择 provider、project、session
2. 前端通过 WebSocket `/ws` 发送命令
3. `server/modules/websocket` 根据消息类型分发到具体 runtime 接入层：
   - `queryClaudeSDK`
   - `queryCodex`
   - `spawnCursor`
   - `spawnGemini`
4. runtime 输出被标准化为前端可消费的消息
5. 前端 `useChatRealtimeHandlers` 写入 `useSessionStore`
6. 需要时再通过 `/api/providers/sessions/:sessionId/messages` 拉历史补齐

这条链路是当前所有聊天 provider 的统一基础链路。

这里有一个很重要的现实约束：运行时接入层并没有完全抽象进 `modules/providers`。

- provider 的“配置、会话历史、技能、MCP、同步”已经模块化
- 但 provider 的“实时运行入口”仍主要在：
  - `server/claude-sdk.js`
  - `server/openai-codex.js`
  - `server/cursor-cli.js`
  - `server/gemini-cli.js`

所以这个项目现在是“双层 provider 架构”：

1. `modules/providers` 负责静态能力和统一服务接口
2. 顶层 runtime 文件负责实时执行与流式输出

这也是后续继续收敛架构时需要关注的一个边界。

## 4.2 项目级 orchestrator 会话链路

1. 创建项目时，同时初始化项目角色模型配置
2. orchestrator 为项目维护根 session
3. 前端侧边栏通过 `/api/orchestrator/projects/:projectId/tree` 拉取树结构
4. 用户选中 orchestrator session 后，主区可展示：
   - 对应聊天视图
   - SessionPanel 元信息
5. orchestrator session 可进一步驱动子 session 创建，或绑定到某个 provider runtime session
6. provider runtime 的流式输出再回流到 orchestrator 语义层

这意味着系统现在有两套身份：

- 逻辑身份：orchestrator session
- 执行身份：runtime session

当前代码明确把两者分开管理，这一点很关键。

## 5. 中间件与系统级能力

### HTTP 中间件

`server/index.js` 中主要挂载了：

- `cors`
- `express.json`
- `express.urlencoded`
- `validateApiKey`
- `authenticateToken`

此外还有几类系统级接入约束：

- `express.static(public)`
- `express.static(dist)`，并按文件类型设置缓存头
- `/api/projects/clone-progress` 使用 SSE
- WebSocket 握手阶段通过 `authenticateWebSocket` 做鉴权

其中：

- `/health` 和 `/api/auth/*` 是公开入口
- 大多数业务路由都受 JWT 保护
- `/api` 先经过可选 API key 验证，再进入具体鉴权

### 鉴权策略

`server/middleware/auth.js` 实现了两套模式：

1. OSS 模式
   - JWT 鉴权
   - 支持 token 自动续期
   - WebSocket 从 query/header 取 token

2. Platform 模式
   - 直接使用数据库中的第一个用户
   - 绕过普通 JWT 流程

这说明系统已在为托管/平台化部署预留模式分支。

### WebSocket

统一 WebSocket server 负责三类连接：

- chat
- shell
- plugin proxy

这比“每个能力单独起 socket server”更集中，也更利于鉴权和广播管理。

其中 `/ws` chat socket 会直接接触几类系统行为：

- provider 启动命令
- 会话恢复
- 中断/终止
- permission request / permission response
- orchestrator tool use / tool result 回流
- active session 状态探测

### 持久化

- SQLite 作为主存储
- `better-sqlite3` 同步调用
- repository 风格正在逐步成形

最近 `e3f0ef5` 提交将 orchestrator session DB 逻辑抽离到 `orchestrator-sessions.db.ts`，表明数据访问层正在从 service 内聚逻辑往独立仓储收敛。

## 6. Provider 架构

Provider 模块是这个项目比较成熟的一层抽象。

每个 provider 当前统一暴露五个 facet：

- `auth`
- `mcp`
- `skills`
- `sessions`
- `sessionSynchronizer`

这个抽象的意义是：

1. 让不同 agent runtime 的接入边界一致
2. 让会话同步、MCP 配置、skills 发现都能走统一服务层
3. 为未来新增 provider 保留了稳定扩展点

从 `server/modules/providers/README.md` 看，这层已经有比较明确的扩展规范，说明它不再是临时 glue code，而是系统级契约层。

## 7. 角色化 Session 编排系统

这是当前仓库最值得关注的改造。

### 7.1 改造目标

以前系统主要围绕 provider session 工作。现在新增了一层“项目级会话编排”：

- 不再把一次对话简单视为 provider session
- 而是把项目中的多个角色会话组织成一棵树
- 每个角色有明确职责边界和 prompt 约束
- provider runtime 只是这些角色会话的执行载体

这是从“聊天 UI”向“多角色协作编排器”演进的明显信号。

### 7.2 当前角色模型

当前定义的 session type：

- `tech_lead`
- `feature_lead`
- `worker`
- `ops`

其中对外强调的角色是：

- `tech_lead`
- `feature_lead`
- `ops`

`worker` 在 prompt 注释里已经被降级为内部兼容的 leaf session 类型。

### 7.3 派生规则

当前代码中的正式派生规则是：

- `tech_lead -> feature_lead`
- `feature_lead -> []`
- `worker -> []`
- `ops -> []`

但 service 层同时保留了一个特例：`worker` 仍允许在已有父 session 下创建。这和 prompt 中“优先使用原生 Task / spawn_agent，而不是正式角色会话”的说法并不完全一致，说明代码和设计意图之间仍存在过渡态。

但从 prompt 文本看，系统仍保留了对子代理/Task 的兼容叙事，也就是说：

- “正式角色会话”与“临时执行子代理”被明确区分
- 角色会话用结构化动作 `create_role`
- 阅读、调查、总结类工作倾向交给原生 `Task/spawn_agent`

这是一种分层编排设计：

- 长生命周期职责 -> orchestrator role session
- 短生命周期执行 -> runtime 原生子代理

### 7.4 orchestrator 持久化模型

当前 orchestrator 相关核心表：

- `orchestrator_sessions`
- `worker_task_specs`
- `session_events`
- `session_artifacts`
- `project_knowledge`

它们分别承载：

- 会话树节点
- worker 任务规格
- 生命周期事件
- 衍生产物
- 项目知识快照/摘要

这说明 orchestrator 已经不只是“prompt 包装器”，而是一个有独立状态机和审计轨迹的子系统。

### 7.5 runtime 与 orchestrator 的分离

这是当前实现里最重要的架构判断之一。

代码明确区分：

- `runtime_session_id`
- orchestrator 内部 `id`

前端也通过 `sessionIdentity.ts` 和 `normalizeOrchestratorSession(...)` 做了双身份映射。

这带来的好处：

1. 可以在不改变上层树结构的情况下切换 runtime provider/model
2. orchestrator 生命周期不依赖具体 CLI 会话格式
3. provider 适配层和编排层可以各自演进

这条边界是稳健的，后续应该继续保持，不要重新耦合回“一个 session id 走天下”。

## 8. `ivhu` 最近提交的演进脉络

这里重点看最近几次和 orchestrator 直接相关的提交。

### 2026-05-26 `cc84538` - `feat: session orchestrator with role-based architecture`

这是第一波大改，主要完成了：

- 新增 orchestrator 模块
- 新增数据库 schema / migration
- 新增角色 prompt 体系
- 新增项目角色模型配置
- 新增前端 session tree 和 session identity 逻辑
- 把 orchestrator 接到 Claude/Codex/Cursor/Gemini 运行链路中

这次提交的性质不是局部功能，而是新增了一个横切全系统的架构层。

### 2026-05-26 `dd7f1a7` - `fix: enforce clean session titles in orchestrator prompts`

这次提交修的是编排系统的一个现实问题：

- 子任务第一行会直接成为前端 session 名称
- 如果 prompt 输出不干净，侧边栏会话树就会退化

这表明当前系统的“UI 命名”已经和“agent 输出协议”产生了直接耦合。

它不是纯展示问题，而是编排协议的一部分。

### 2026-05-26 `9ebcd81` - `feat: new project`

这个提交名看起来偏品牌/项目重命名，但它也顺手触达了 orchestrator 相关表面：

- README 和对外定位改成 CodeAgent UI
- `projects.routes.ts` / `orchestrator.service.ts` / `prompts.ts` 有增量调整
- session identity、ChatInterface、Sidebar 等继续适配 orchestrator 流程

它的意义不是新架构，而是说明 orchestrator 已经从“实验性分支”进入项目主叙事。

### 2026-05-27 `e3f0ef5` - `feat: adj orchestrator session db`

这次提交的核心是：

- 新增 `server/modules/database/repositories/orchestrator-sessions.db.ts`
- 从 `orchestrator.service.ts` 中剥离大量 DB 访问逻辑
- 更新文档

这说明 orchestrator 初版已经进入“收敛层次、降低 service 复杂度”的阶段。

从架构角度看，这一步是健康的，后续应继续往：

- service 负责编排规则
- repository 负责数据访问
- route 负责输入输出协议

这个分层方向推进。

### 2026-05-26 到 2026-05-27 的其它小提交

从 git log 看，最近还有几次围绕 orchestrator 的修整提交：

- `47d70e2` - `chore: fix new worker miss node`
- `289ab28` - `chore: clean log`
- `ad6da09` - `feat: add readme`
- `ea10158` - `feat: adj tree node sort`

这些提交说明两个现状：

1. session tree 的展示和节点生成逻辑还在快速打磨
2. orchestrator 当前已经进入“持续修边”和“补交互一致性”的阶段，而不只是一次性落地

## 9. 当前架构的几个关键判断

### 9.1 这不是微服务，而是单体中的分层编排系统

项目目前依然是单进程、单仓库、单数据库的应用。

但内部已经出现了比较清晰的分层：

- UI 层
- WebSocket/HTTP 接入层
- provider 适配层
- project 聚合层
- orchestrator 编排层
- repository/SQLite 持久化层

所以更准确的描述是：

“一个持续演进中的模块化单体，正在向多角色编排平台靠拢。”

### 9.2 provider 层和 orchestrator 层是两条主轴

现在的系统复杂度主要来自两条正交维度：

1. 横向 provider 兼容
2. 纵向角色编排

这两个维度叠加之后，所有 session 相关逻辑都会变复杂，因此后续最需要守住的是边界，而不是继续把逻辑堆进 runtime 文件。

### 9.3 当前 `worker` 语义仍处在过渡态

数据库和前端树仍认识 `worker`。
但 prompt 和当前编排描述更强调 `tech_lead / feature_lead / ops + 原生 Task`。

这意味着现在处于一个迁移中间态：

- 数据模型仍保留 worker
- 角色模型在向“正式角色 + 临时子代理”收敛

后续如果继续演进，最好明确二选一：

1. 保留 `worker` 作为正式 orchestrator leaf role
2. 或把 `worker` 完全降级为 runtime 执行产物，不再当作一等会话类型

否则树结构、权限规则、UI 文案、数据库约束会长期存在双重语义。

## 10. 当前值得重点关注的风险点

### 10.1 Prompt 协议与系统行为强耦合

编排动作依赖结构化 JSON 输出。
session 标题又依赖 prompt 第一行格式。

这意味着：

- prompt 不是软约束，而是系统协议的一部分
- prompt 改动可能直接影响创建子 session、命名和 UI 表现

后续如果继续增强 orchestrator，建议把更多“必须正确”的协议约束收敛到显式解析和 schema 校验上，少依赖自然语言提示。

### 10.2 runtime session 与 orchestrator session 的映射复杂度会持续上升

现在前端已经需要：

- `getSessionRuntimeId`
- `getSessionOrchestratorId`
- `normalizeOrchestratorSession`
- `sessionAliases`

这说明身份映射已经是系统级复杂点。

如果未来要支持：

- 一个 orchestrator session 多次运行
- 运行重试
- runtime 切换
- 多 provider fallback

那么建议进一步显式化“run”这一层，而不只是把状态堆在 session 上。

### 10.3 orchestrator service 仍然偏大

尽管最近已经抽出了 repository，但 `orchestrator.service.ts` 仍然承担了很多职责：

- 创建和校验规则
- prompt 组装
- 子 session materialization
- runtime 绑定
- 状态机更新
- 事件记录

后续可以考虑继续分为：

- `session-creation` / `derivation-policy`
- `runtime-binding`
- `session-status`
- `prompt-composition`
- `role-action-dispatch`
- `event-recording`

不一定要马上拆，但这是自然演进方向。

### 10.4 项目角色配置与运行时默认值存在双处定义

当前默认角色模型配置同时存在于：

- `server/modules/projects/project-role-config.ts`
- `src/components/project-role-config/roleModelConfig.ts`

两边目前是一致的：

- `tech_lead -> codex / gpt-5.5`
- `feature_lead -> codex / gpt-5.4`
- `ops -> codex / gpt-5.4`

但这种前后端双写默认值的方式，后续容易出现配置漂移。更稳妥的方向是：

- 前端只做展示和编辑
- 后端提供唯一默认值来源
- 前端从接口取默认 schema 或初始化值

### 10.5 tree 视图和状态排序已经成为产品级行为，不再只是 UI 细节

`SidebarSessionTree.tsx` 当前会按：

1. `run_status === running` 优先
2. `updated_at` 倒序

排序，并默认展开非 `worker` 的有子节点分支。

这意味着 session tree 已经承担“工作流导航器”的职责，而不是静态列表。后续如果再引入：

- waiting_input 优先级
- blocked 高亮
- 失败节点聚类
- 大树懒加载

建议把排序和树投影规则进一步收敛成显式策略，而不是继续散落在前端组件里。

## 11. 建议的阅读顺序

如果要继续理解或改这个项目，建议按下面顺序看：

1. `README.md`
2. `server/index.js`
3. `server/modules/providers/README.md`
4. `server/modules/websocket/README.md`
5. `server/modules/orchestrator/prompts.ts`
6. `server/modules/orchestrator/orchestrator.service.ts`
7. `server/modules/database/repositories/orchestrator-sessions.db.ts`
8. `src/utils/sessionIdentity.ts`
9. `src/hooks/useSessionTree.ts`
10. `src/components/sidebar/view/subcomponents/SidebarSessionTree.tsx`
11. `src/components/chat/view/ChatInterface.tsx`
12. `docs/role-session-architecture.md`

## 12. 总结

当前项目已经不是一个简单的 agent chat UI。

它的核心架构可以概括为：

- 一个 React + Express + WebSocket + SQLite 的模块化单体
- 通过 provider 抽象统一接入多个 AI coding runtime
- 通过 orchestrator 子系统把项目内的角色会话树、知识、状态和执行链路组织起来

最近 `ivhu` 的提交，实质上是在把这个项目从“多 provider 会话浏览器”推进成“项目级、多角色、可持久化的 session 编排系统”。

当前这条方向是可行的，而且已经有了比较明确的基础骨架。接下来最重要的不是再加更多 prompt，而是继续收紧：

- session 身份模型
- 编排协议
- service/repository 分层
- 角色模型的一致性

这样后续扩展才不会失控。
