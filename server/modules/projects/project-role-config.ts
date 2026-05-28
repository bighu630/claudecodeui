import type { LLMProvider } from '@/shared/types.js';

export type ProjectRoleType = 'tech_lead' | 'feature_lead' | 'ops';
export type ProjectRoleModelConfigEntry = {
  provider: LLMProvider;
  model: string;
};
export type ProjectRoleModelConfig = Record<ProjectRoleType, ProjectRoleModelConfigEntry>;

export const PROJECT_ROLE_TYPES: ProjectRoleType[] = ['tech_lead', 'feature_lead', 'ops'];

const DEFAULT_PROJECT_ROLE_MODEL_CONFIG: ProjectRoleModelConfig = {
  tech_lead: {
    provider: 'codex',
    model: 'gpt-5.5',
  },
  feature_lead: {
    provider: 'codex',
    model: 'gpt-5.4',
  },
  ops: {
    provider: 'codex',
    model: 'gpt-5.4',
  },
};

const SUPPORTED_PROVIDERS = new Set<LLMProvider>(['claude', 'codex', 'cursor', 'gemini']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneDefaults(): ProjectRoleModelConfig {
  return {
    tech_lead: { ...DEFAULT_PROJECT_ROLE_MODEL_CONFIG.tech_lead },
    feature_lead: { ...DEFAULT_PROJECT_ROLE_MODEL_CONFIG.feature_lead },
    ops: { ...DEFAULT_PROJECT_ROLE_MODEL_CONFIG.ops },
  };
}

export function getDefaultProjectRoleModelConfig(): ProjectRoleModelConfig {
  return cloneDefaults();
}

export function normalizeProjectRoleModelConfig(input: unknown): ProjectRoleModelConfig {
  const normalized = cloneDefaults();
  if (!isPlainObject(input)) {
    return normalized;
  }

  for (const role of PROJECT_ROLE_TYPES) {
    const roleValue = input[role];
    if (!isPlainObject(roleValue)) {
      continue;
    }

    const providerCandidate = roleValue.provider;
    const modelCandidate = roleValue.model;
    const provider = typeof providerCandidate === 'string' && SUPPORTED_PROVIDERS.has(providerCandidate as LLMProvider)
      ? providerCandidate as LLMProvider
      : normalized[role].provider;
    const model = typeof modelCandidate === 'string' && modelCandidate.trim().length > 0
      ? modelCandidate.trim()
      : normalized[role].model;

    normalized[role] = {
      provider,
      model,
    };
  }

  return normalized;
}
