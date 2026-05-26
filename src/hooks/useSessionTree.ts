import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '../utils/api';
import type {
  AppSocketMessage,
  SessionTreeNode,
  SessionTreeResponse,
  OrchestratorSession,
  SessionDetailResponse,
  WorkerTaskSpec,
} from '../types/app';

function isTreeRelevantRealtimeMessage(message: AppSocketMessage | null): boolean {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const typedMessage = message as Record<string, unknown>;
  const type = typeof typedMessage.type === 'string' ? typedMessage.type : '';
  const kind = typeof typedMessage.kind === 'string' ? typedMessage.kind : '';

  return type === 'projects_updated'
    || kind === 'tool_use'
    || kind === 'tool_result'
    || kind === 'session_created';
}

export function useSessionTree(projectId: string | null, latestMessage: AppSocketMessage | null = null) {
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

  useEffect(() => {
    if (!projectId || !isTreeRelevantRealtimeMessage(latestMessage)) {
      return;
    }

    void fetchTree();
  }, [fetchTree, latestMessage, projectId]);

  return { tree, loading, error, refresh: fetchTree };
}

export function useSessionDetail(sessionId: string | null) {
  const [session, setSession] = useState<OrchestratorSession | null>(null);
  const [taskSpec, setTaskSpec] = useState<WorkerTaskSpec | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await authenticatedFetch(`/api/orchestrator/sessions/${encodeURIComponent(sessionId)}`);
      const data: SessionDetailResponse = await res.json();
      setSession(data.session);
      setTaskSpec(data.taskSpec);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { session, taskSpec, loading, refresh };
}
