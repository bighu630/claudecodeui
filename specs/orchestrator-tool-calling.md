# Orchestrator 角色管理工具调用

## 目标

将角色会话创建从被动拦截改为 LLM 主动调用 orchestrator 工具。tech_lead / feature_lead / ops 能主动调用工具创建子角色，不再依赖代码拦截 agent 的 tool_use 事件。

## 角色体系

三个角色，无 worker：

| 角色 | 定位 | 可创建的角色 | 可用子代理 |
|---|---|---|---|
| tech_lead | 架构决策、可行性判断 | feature_lead | 是 |
| feature_lead | 方案落地、任务拆分 | 无 | 是 |
| ops | 运维支持、环境操作 | 无 | 是 |

- 所有角色都可以使用原生 spawn_agent / Task 创建子代理做阅读、调查、总结等上下文隔离工作。
- 子代理不是角色，不设独立 system prompt。拦截到子代理创建后，在 session 树中记录为轻量叶子节点（仅标题和目标，无 role_prompt）。
- 现行拦截逻辑保持，仍然识别 spawn_agent / Task 并创建子代理叶子节点。

## 两个 Orchestrator 工具

### orchestrator_lookup_role

- 参数: `role_type: string`
- 返回: 该角色的定位、职责、边界、输出偏好原文
- 场景: LLM 在创建角色前确认某个角色的职责边界

### orchestrator_create_role

- 参数:
  - `role_type: string` — tech_lead | feature_lead | ops
  - `title: string` — 会话标题
  - `goal: string` — 目标和需求描述
  - `constraints?: string` — 约束条件（可选）
  - `custom_role_def?: object` — 预留字段，当下不生效（见「自定义角色预留」节）
- 行为:
  1. 校验 role_type、派生规则（tech_lead 才能创建 feature_lead）
  2. 调用现有 `createSession` 创建 session
  3. 同步调用 auto-run（复用现有 provider 分发逻辑: claude-sdk / cursor / codex / gemini）
  4. 轮询等待 runtime_session_id 就绪，超时 10s
  5. 返回 `{ session_id, role_type, title, runtime_session_id }`，超时时 `{ session_id, status: "timeout" }`
- 不需要 auto_run 参数，创建即运行

## SYSTEM_BASE_PROMPT 变更

在现有 `prompts.ts` 的 SYSTEM_BASE_PROMPT 末尾追加「角色管理能力」段落（约 12-15 行中文）：

- 你有 orchestrator_lookup_role 和 orchestrator_create_role 两个工具
- 描述每个工具做什么、何时用
- 子代理不是角色，用原生 spawn_agent 即可，会被自动追踪记录
- 建议各角色在需要拆分阅读/调查/总结类任务时使用子代理保持上下文整洁

注意: 不放 JSON Schema，只放行为描述。JSON Schema 在 provider 层注入。

## prompts.ts 变更清单

1. 移除 WORKER_PROMPT 常量（不再有 worker 角色）
2. `SessionType` 类型改为 `'tech_lead' | 'feature_lead' | 'ops'`
3. DERIVATION_RULES 改为:

```
tech_lead → [feature_lead]
feature_lead → []
ops → []
```

4. SYSTEM_BASE_PROMPT 追加角色管理能力段落
5. 导出工具定义描述（紧凑文本，不含 JSON Schema）:

```typescript
export const ORCHESTRATOR_TOOLS = [
  {
    name: 'orchestrator_lookup_role',
    description: '查看某个角色的定位、职责、边界和输出偏好',
    input_schema: { role_type: 'string' },
  },
  {
    name: 'orchestrator_create_role',
    description: '创建子角色会话',
    input_schema: {
      role_type: 'string (tech_lead|feature_lead|ops)',
      title: 'string',
      goal: 'string',
      constraints: 'string (optional)',
    },
  },
];
```

6. `getRolePrompt` 移除 worker case

## orchestrator.service.ts 变更清单

1. 新增 `handleOrchestratorToolCall(toolName, input, parentSessionId)`:
   - `orchestrator_lookup_role`: 读 `getRolePrompt(input.role_type)` 返回原文
   - `orchestrator_create_role`: 校验 → `createSession` → `autoRunSession` 同步阻塞等 runtime_session_id → 返回结果
   - 返回格式: `{ requires_response: true, result: { ... } }`
2. 移除 worker 相关的 SESSION_DEFAULTS、ROOT_SESSION_GOALS 等记录
3. `autoRunSession` 改为可同步等待 runtime_session_id（当前是 fire-and-forget），加 10s 超时。实现方式: 在 provider adapter 中挂载一个 resolve 回调，或者用轮询 `getSession` 直到 runtime_session_id 不为 null
4. `materializeChildSessionFromTool` 改为创建子代理叶子节点（无 role_prompt，仅标题和目标），其他逻辑不变
5. `deriveChildSessionType` 不再返回 'worker'，返回 null 时走子代理叶子节点路径

## Provider 适配器变更（4 个文件）

通用模式:
1. 在请求时将 orchestrator 工具注入 tools 列表（JSON Schema 格式，各 SDK 适配）
2. 在 tool_use 事件处理中，先检查 toolName 是否为 `orchestrator_lookup_role` / `orchestrator_create_role`
3. 如是，调 `handleOrchestratorToolCall`，拿到 `{ requires_response: true, result }`，构造 tool_result 消息推回给 LLM
4. 如否，走现有拦截逻辑（子代理叶子节点）

### claude-sdk.js

- 在 API 请求的 `tools` 数组追加两个 orchestrator 工具定义的 JSON Schema
- 在 tool_use 事件处理中（约 699 行），优先匹配 orchestrator 工具名
- 构造 tool_result 通过 writer.send / ws.send 推回

### openai-codex.js

- 在 API 请求的 `tools` 数组追加两个 orchestrator 工具定义
- 在 tool_use 事件处理中（约 319 行），优先匹配 orchestrator 工具名
- 构造 tool_result 推回

### gemini-response-handler.js

- 在请求时注入 function_declarations
- 在 tool_use 事件处理中（约 66 行），优先匹配 orchestrator 工具名
- 构造 tool_result 推回

### cursor-cli.js

- Cursor CLI 的 tool_use 支持需要确认。如果不支持原生 function calling，使用文本解析方案: SYSTEM_BASE_PROMPT 中要求 AI 输出特定 XML 标签，provider 解析后调用 handler。

## 同步 auto-run 实现

当前 `queueChildSessionAutoRun` → `autoRunSession` 是 async fire-and-forget。改造为同步等待：

```typescript
async function autoRunSessionSync(sessionId: string): Promise<string | null> {
  const session = getSession(sessionId);
  // 启动 auto-run（现有逻辑）
  await autoRunSession(sessionId);
  // 轮询 runtime_session_id，每 200ms 检查一次，最多 10s
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const updated = getSession(sessionId);
    if (updated?.runtime_session_id) return updated.runtime_session_id;
    await new Promise(r => setTimeout(r, 200));
  }
  return null; // 超时
}
```

## 自定义角色预留

`orchestrator_create_role` 的 input 预留字段：

```json
{
  "custom_role_def": {
    "positioning": "string (角色定位)",
    "responsibilities": "string (职责)",
    "boundaries": "string (边界)",
    "output_preferences": "string (输出偏好)"
  }
}
```

当下该字段接受但不影响提示词拼装（仍走硬编码角色提示词）。后续 `composePrompt` 改为: 存在 custom_role_def 时使用自定义内容，不存在时回退硬编码。

## 不碰什么

- session 创建流程和数据库模型
- orchestrator routes / index 导出
- 现有 prompts.test.ts 测试结构（需更新用例以反映 worker 移除）
- 项目知识摘要相关逻辑

## 验收标准

1. tech_lead 能调 `orchestrator_create_role(role_type='feature_lead', ...)` 创建 feature_lead，返回 session_id + runtime_session_id
2. feature_lead session 正常启动（bootstrap prompt 拼接、provider 启动、auto-run 正常）
3. `orchestrator_lookup_role('feature_lead')` 返回 feature_lead 的定位/职责/边界/输出偏好原文
4. 子代理拦截逻辑不变，spawn_agent/Task 仍创建叶子节点
5. 10s 超时机制生效，超时时返回 error 状态
6. 现有测试可通过更新
