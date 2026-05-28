import type { ProjectRoleModelConfig, ProjectRoleType } from '../../types/app';

export const PROJECT_ROLE_TYPES: ProjectRoleType[] = ['tech_lead', 'feature_lead', 'ops'];

export const PROJECT_ROLE_LABELS: Record<ProjectRoleType, string> = {
  tech_lead: 'Tech Lead',
  feature_lead: 'Feature Lead',
  ops: 'Ops',
};

export const DEFAULT_PROJECT_ROLE_MODEL_CONFIG: ProjectRoleModelConfig = {
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

export function cloneDefaultProjectRoleModelConfig(): ProjectRoleModelConfig {
  return {
    tech_lead: { ...DEFAULT_PROJECT_ROLE_MODEL_CONFIG.tech_lead },
    feature_lead: { ...DEFAULT_PROJECT_ROLE_MODEL_CONFIG.feature_lead },
    ops: { ...DEFAULT_PROJECT_ROLE_MODEL_CONFIG.ops },
  };
}

export function normalizeProjectRoleModelConfig(input?: Partial<ProjectRoleModelConfig> | null): ProjectRoleModelConfig {
  const normalized = cloneDefaultProjectRoleModelConfig();
  if (!input) {
    return normalized;
  }

  for (const role of PROJECT_ROLE_TYPES) {
    const next = input[role];
    if (!next) {
      continue;
    }

    normalized[role] = {
      provider: next.provider ?? normalized[role].provider,
      model: typeof next.model === 'string' && next.model.trim().length > 0 ? next.model.trim() : normalized[role].model,
    };
  }

  return normalized;
}
