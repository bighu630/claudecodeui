// ─── System base prompt (all sessions share this) ───
export const SYSTEM_BASE_PROMPT = `你正在一个项目级多 Session 编排系统中工作。

行为规则：
1. 你属于某个明确的 session 角色，只能在该角色职责范围内工作。
2. 你不能假设自己拥有其它 session 的权限。
3. 你必须以工程任务为中心，输出清晰、可执行、可验收的结果。
4. 信息不足以继续时，必须明确指出阻塞原因，而不是编造上下文。
5. 需要拆分工作时，仅在当前角色允许的范围内推进，不得假设自己可以任意创建其它角色。
6. 输出偏向工程实施，不做无边界讨论。

角色管理能力：
1. 当你需要查询角色定位、职责、边界和输出偏好时，输出结构化动作 \`lookup_role\`。
2. 当你需要在角色边界内正式创建新的角色会话时，输出结构化动作 \`create_role\`。
3. \`create_role\` 只用于创建正式角色会话，不用于阅读、调查、总结这类临时上下文隔离任务。
4. tech_lead 只能创建 feature_lead。
5. feature_lead 不能创建新的 feature_lead。
6. ops 不能创建新的角色会话。
7. 子代理不是角色；需要拆分阅读、调查、总结或局部执行任务时，优先使用原生 spawn_agent / Task。
8. 原生 spawn_agent / Task 会被系统自动追踪并记录为叶子节点。
9. 只有在确实需要一个独立角色长期承接职责时，才创建角色会话。
10. 创建角色会话前，如职责边界不清楚，先输出 \`lookup_role\` 再决定。
11. 创建角色会话时，只传递完成任务所需的必要知识、目标、约束和验收口径。
12. 不要为了重复当前工作而创建角色；创建后应把任务责任清晰地下放。
13. 当系统要求你输出结构化动作时，严格输出单个 JSON 对象，不要附带 markdown、解释或多余文本。`;

// ─── Role-specific prompts ───
export const TECH_LEAD_PROMPT = `你是当前项目的 tech_lead。

角色定位：
1. 你是垂直领域专家和高级架构师。
2. 你主要负责判断需求或问题能不能做、应该怎么做、方案是否稳健，以及未来如何扩展。
3. 你代表上层技术决策，不负责贴近代码的一线实现推进。

职责：
1. 接收用户提出的需求、功能或问题。
2. 优先分析业务目标、技术可行性、系统边界、关键风险和长期扩展性。
3. 在必要时给出高层实现方向、架构建议、模块划分和约束条件。
4. 为下游执行提供清晰、稳定、可落地的任务目标，而不是替下游完成实现细化。
5. 一旦确认可以做并创建 feature_lead 角色会话，你当前这轮任务即完成，不要等待 feature_lead 的返回结果。

边界：
1. 你可以与用户对话。
2. 你可以创建或推动形成 feature_lead,去实现具体需求或bug修复；创建后代表这件事已经进入落地阶段，除非用户提起，不要重复处理同一件事。
3. 你可以用subagent看代码，查资料等。
4. 你需要判断可行性、识别架构约束或排查关键风险时才看必要代码。
5. 你不负责深入代码细节、任务拆分、具体验证或直接实现。

输出偏好：
1. 优先给出可行性判断、总体方案、架构影响、稳健性分析和扩展性判断。
2. 若决定继续推进需求/bug，实现指令应面向 feature_lead，只描述要实现什么、成功标准、范围和约束, 另外你可以用subagent去阅读/总结。
3. 避免进入过早的代码级实现细节，除非这是完成架构判断所必需的。
4. 后续需求跟进默认由用户直接与 feature_lead 对接，而不是继续由你充当中间层。
5. 创建 feature_lead 角色时，标题应简短准确；不要复制整段上下文，只传递必要知识、目标、约束和验收标准。
6. 你可以对单个用户需求创建多个 feautre_lead 来把一个大的任务拆分成多个一般大的任务(仅在任务很大的时候拆分)`;

export const FEATURE_LEAD_PROMPT = `你是当前项目的 feature_lead。

角色定位：
1. 你负责把上级给出的目标落到代码层面的可实施方案。
2. 你需要主动看代码、理解现有实现、确认边界，并把模糊目标细化为可执行任务。
3. 你是方案落地负责人，不是纯分析角色，也不是只做单点编码的执行角色。

职责：
1. 理解并细化上级交付的目标。
2. 查看相关代码、梳理现状、识别实现约束和风险。
3. 必要时与用户对齐需求细节、交互预期、范围取舍和验收口径。
4. 敲定实现方案，明确改动范围、接口影响、验证方式和回退点。
5. 在需要具体执行、阅读、调查或总结时，主动使用子代理隔离上下文。
6. 汇总子代理结果，完成验收并向用户或上游反馈结果、验证情况和剩余风险。

边界：
1. 你可以与用户对话。
2. 你不能创建新的 feature_lead 角色。
3. 你不能把高层可行性分析职责退回给子代理。
4. 你不能把子代理当作无边界的自由对话代理。
5. 你不能修改项目知识摘要。

输出偏好：
1. 先看代码并形成实现方案，再决定是否拆子代理。
2. 任务拆分必须围绕明确方案，输入、范围、约束和验收标准要完整。
3. 对用户和上级输出时，优先说明实现决策、代码影响、验证结果和剩余风险。
4. 如果子代理结果不足以验收，明确指出缺口并决定下一步。
5. 创建子代理时，明确任务目标、范围、约束和验收标准，不要 fork 当前上下文，只传递完成任务所需的必要知识、目标、约束和验收标准。`;

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
// `worker` remains as an internal leaf-session type for compatibility with the
// existing database model and UI tree, but it is no longer a first-class role.
export type SessionType = 'tech_lead' | 'feature_lead' | 'worker' | 'ops';

export function getRolePrompt(type: SessionType): string {
  switch (type) {
    case 'tech_lead': return TECH_LEAD_PROMPT;
    case 'feature_lead': return FEATURE_LEAD_PROMPT;
    case 'worker': return '';
    case 'ops': return OPS_PROMPT;
  }
}

export const ORCHESTRATOR_TOOLS = [
  {
    name: 'orchestrator_lookup_role',
    description: '查看某个角色的定位、职责、边界和输出偏好',
    input_schema: {
      role_type: 'string',
    },
  },
  {
    name: 'orchestrator_create_role',
    description: '创建子角色会话',
    input_schema: {
      role_type: 'string (tech_lead|feature_lead|ops)',
      title: 'string',
      goal: 'string',
      constraints: 'string (optional)',
      custom_role_def: 'object (optional, reserved)',
    },
  },
] as const;

export const ORCHESTRATOR_ACTION_SCHEMA = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['message', 'lookup_role', 'create_role'],
    },
    message: {
      type: 'string',
    },
    role_type: {
      type: 'string',
      enum: ['tech_lead', 'feature_lead', 'ops'],
    },
    title: {
      type: 'string',
    },
    goal: {
      type: 'string',
    },
    constraints: {
      type: 'string',
    },
  },
  required: ['type'],
  additionalProperties: false,
  allOf: [
    {
      if: {
        properties: {
          type: { const: 'message' },
        },
        required: ['type'],
      },
      then: {
        required: ['message'],
      },
    },
    {
      if: {
        properties: {
          type: { const: 'lookup_role' },
        },
        required: ['type'],
      },
      then: {
        required: ['role_type'],
      },
    },
    {
      if: {
        properties: {
          type: { const: 'create_role' },
        },
        required: ['type'],
      },
      then: {
        required: ['role_type', 'title', 'goal'],
      },
    },
  ],
} as const;

export type OrchestratorStructuredAction =
  | {
      type: 'message';
      message: string;
    }
  | {
      type: 'lookup_role';
      role_type: 'tech_lead' | 'feature_lead' | 'ops';
      message?: string;
    }
  | {
      type: 'create_role';
      role_type: 'tech_lead' | 'feature_lead' | 'ops';
      title: string;
      goal: string;
      constraints?: string;
      message?: string;
    };

export function getOrchestratorStructuredOutputInstruction(): string {
  return [
    '结构化动作输出协议：',
    '1. 可用 type 只有 lookup_role、create_role, 如果你不用这两个功能就忽略这个协议',
    '2. 只输出单个 JSON 对象，不要包含 markdown 代码块。',
    '3. 查询角色定义时输出 {"type":"lookup_role","role_type":"feature_lead"} 这类对象。',
    '4. 创建角色时输出 {"type":"create_role","role_type":"feature_lead","title":"...","goal":"...","constraints":"..."}。',
    '5. 如果本轮动作已由系统执行并返回结果，你要基于结果继续输出下一个 JSON 对象。',
  ].join('\n');
}

export function buildOrchestratorActionResultMessage(
  action: OrchestratorStructuredAction,
  result: Record<string, unknown>,
): string {
  return [
    '系统已在宿主进程执行你请求的角色动作。',
    `动作：${JSON.stringify(action, null, 2)}`,
    `结果：${JSON.stringify(result, null, 2)}`,
    '请基于这个结果继续推进，并继续严格输出单个 JSON 对象。',
  ].join('\n\n');
}

function extractJsonObjectCandidate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }

  return trimmed.slice(start, end + 1);
}

export function parseOrchestratorStructuredAction(value: string): OrchestratorStructuredAction {
  const candidate = extractJsonObjectCandidate(value);
  if (!candidate) {
    throw new Error('No JSON object found in structured orchestrator action');
  }

  const parsed = JSON.parse(candidate) as Record<string, unknown>;
  const type = typeof parsed.type === 'string' ? parsed.type.trim() : '';

  if (type === 'message') {
    const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
    if (!message) {
      throw new Error('Structured orchestrator message action requires message');
    }
    return {
      type,
      message,
    };
  }

  const roleType = typeof parsed.role_type === 'string' ? parsed.role_type.trim() : '';
  if (roleType !== 'tech_lead' && roleType !== 'feature_lead' && roleType !== 'ops') {
    throw new Error(`Structured orchestrator action has unsupported role_type '${roleType || 'unknown'}'`);
  }

  if (type === 'lookup_role') {
    return {
      type,
      role_type: roleType,
      message: typeof parsed.message === 'string' ? parsed.message.trim() || undefined : undefined,
    };
  }

  if (type === 'create_role') {
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    const goal = typeof parsed.goal === 'string' ? parsed.goal.trim() : '';
    if (!title) {
      throw new Error('Structured orchestrator create_role action requires title');
    }
    if (!goal) {
      throw new Error('Structured orchestrator create_role action requires goal');
    }

    const constraints = typeof parsed.constraints === 'string' ? parsed.constraints.trim() : '';
    return {
      type,
      role_type: roleType,
      title,
      goal,
      constraints: constraints || undefined,
      message: typeof parsed.message === 'string' ? parsed.message.trim() || undefined : undefined,
    };
  }

  throw new Error(`Unsupported structured orchestrator action type '${type || 'unknown'}'`);
}

export function tryParseOrchestratorStructuredAction(value: string): OrchestratorStructuredAction | null {
  try {
    return parseOrchestratorStructuredAction(value);
  } catch {
    return null;
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
    '',
    '─── 结构化动作协议 ───',
    getOrchestratorStructuredOutputInstruction(),
  ].join('\n');
}

// ─── Feature lead startup message template ───
export function featureLeadStartupMessage(goal: string, constraints: string): string {
  const conciseGoal = goal.trim() || '请承接上级刚确认可执行的需求';

  return `需求简介：${conciseGoal}

目标：
${goal}

约束：
${constraints}

要求：
1. 优先与用户确认仍然缺失的范围、约束、交互预期和验收口径，不要默认细节已经完整。
2. 在查看代码和形成方案时，主动评估是否适合借助 superpowers 提升实现质量或推进效率。
3. 在需求边界清楚后，再查看相关代码，补齐实现细节，形成可落地方案。
4. 如需执行具体实现、阅读、调查或总结，拆分出结构化子任务并创建子代理。
5. 汇总子代理结果后给出验收结论、测试说明和剩余风险。
6. 不得把子代理当作无边界的自由聊天对象。`;
}

// ─── Subagent startup message template ───
export function subagentStartupMessage(taskSpec: {
  title: string;
  objective: string;
  scope: string;
  constraints: string;
  input_context: string;
  expected_output: string;
  acceptance_criteria: string;
}): string {
  return `子任务：
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

要求：
1. 严格围绕当前子任务执行，不扩展范围。
2. 信息不足时，明确指出阻塞点，不要自行编造上下文。
3. 输出要直接服务于上游会话的验收与决策。`;
}
