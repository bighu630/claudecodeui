import type { LLMProvider, ProjectSession } from '../../../types/app';
import { isOrchestratorSession } from '../../../utils/sessionIdentity';

type ProviderModelState = {
  claudeModel: string;
  cursorModel: string;
  codexModel: string;
  geminiModel: string;
};

type OrchestratorSessionShape = ProjectSession & {
  provider?: LLMProvider | null;
  model?: string | null;
};

export const resolveSessionProvider = (
  session: ProjectSession | null | undefined,
  fallbackProvider: LLMProvider,
): LLMProvider => {
  if (isOrchestratorSession(session) && session.provider) {
    return session.provider;
  }

  return (session?.__provider || fallbackProvider) as LLMProvider;
};

export const resolveSessionModel = (
  session: ProjectSession | null | undefined,
  provider: LLMProvider,
  providerModels: ProviderModelState,
): string => {
  if (isOrchestratorSession(session) && typeof session.model === 'string' && session.model.trim()) {
    return session.model;
  }

  if (provider === 'cursor') {
    return providerModels.cursorModel;
  }
  if (provider === 'codex') {
    return providerModels.codexModel;
  }
  if (provider === 'gemini') {
    return providerModels.geminiModel;
  }
  return providerModels.claudeModel;
};
