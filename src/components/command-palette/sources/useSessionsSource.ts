import { authenticatedFetch } from '../../../utils/api';
import type { LLMProvider, SessionTreeNode } from '../../../types/app';

import { useApiSource } from './useApiSource';

export type SessionResult = {
  id: string;
  label: string;
  provider?: LLMProvider;
};

interface SessionsResponse {
  tree?: SessionTreeNode[];
}

const flattenTree = (nodes: SessionTreeNode[]): SessionTreeNode[] => {
  const result: SessionTreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    result.push(...flattenTree(node.children ?? []));
  }
  return result;
}

export function useSessionsSource(projectId: string | undefined, enabled: boolean) {
  return useApiSource<SessionResult, SessionsResponse>({
    enabled: enabled && !!projectId,
    deps: [projectId],
    fetcher: (signal) => {
      return authenticatedFetch(
        `/api/orchestrator/projects/${encodeURIComponent(projectId!)}/tree`,
        { signal },
      );
    },
    parse: (data) => {
      return flattenTree(data.tree ?? []).map<SessionResult>((session) => ({
        id: session.id,
        label: session.title || session.summary_text || session.id,
        provider: session.provider ?? undefined,
      }));
    },
  });
}
