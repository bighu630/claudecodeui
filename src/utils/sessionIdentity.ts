import type { OrchestratorSession, ProjectSession } from '../types/app';

type OrchestratorLikeSession = ProjectSession & Partial<OrchestratorSession>;

export const isOrchestratorSession = (
  session: ProjectSession | null | undefined,
): session is OrchestratorLikeSession => (
  Boolean(session && typeof (session as OrchestratorLikeSession).interaction_mode === 'string')
);

export const getSessionOrchestratorId = (
  session: ProjectSession | null | undefined,
): string | null => {
  if (!session) {
    return null;
  }

  const explicitId = session.orchestratorSessionId;
  if (typeof explicitId === 'string' && explicitId.trim()) {
    return explicitId;
  }

  return isOrchestratorSession(session) && typeof session.id === 'string' && session.id.trim()
    ? session.id
    : null;
};

export const getSessionRuntimeId = (
  session: ProjectSession | null | undefined,
  fallbackSessionId: string | null = null,
): string | null => {
  if (!session) {
    return fallbackSessionId;
  }

  const legacyRuntimeId = (session as { runtimeSessionId?: unknown }).runtimeSessionId;
  if (typeof legacyRuntimeId === 'string' && legacyRuntimeId.trim()) {
    return legacyRuntimeId;
  }

  if (typeof session.runtime_session_id === 'string' && session.runtime_session_id.trim()) {
    return session.runtime_session_id;
  }

  if (isOrchestratorSession(session)) {
    return null;
  }

  return typeof session.id === 'string' && session.id.trim() ? session.id : fallbackSessionId;
};

export const getSessionRouteId = (
  session: ProjectSession | null | undefined,
): string | null => {
  const runtimeSessionId = getSessionRuntimeId(session);
  if (runtimeSessionId) {
    return runtimeSessionId;
  }

  return getSessionOrchestratorId(session);
};

export const normalizeOrchestratorSession = (
  session: OrchestratorSession | OrchestratorLikeSession,
  projectId: string,
): ProjectSession => {
  // Use runtime_session_id as the primary ProjectSession.id when available.
  // The orchestrator's internal id is preserved in orchestratorSessionId.
  const primaryId = session.runtime_session_id || session.id;
  return {
    ...session,
    id: primaryId,
    orchestratorSessionId: session.id,
    __projectId: projectId,
    __provider: session.provider ?? undefined,
    title: session.title,
    summary: session.summary_text || session.title,
  };
};
