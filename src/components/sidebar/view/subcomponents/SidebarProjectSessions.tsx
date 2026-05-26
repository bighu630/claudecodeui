import type { TFunction } from 'i18next';

import { useSessionTree } from '../../../../hooks/useSessionTree';
import type { AppSocketMessage, Project, ProjectSession, LLMProvider, SessionTreeNode } from '../../../../types/app';
import { getSessionOrchestratorId } from '../../../../utils/sessionIdentity';
import type { SessionWithProvider } from '../../types/types';

import SidebarSessionTree from './SidebarSessionTree';

type SidebarProjectSessionsProps = {
  project: Project;
  isExpanded: boolean;
  latestMessage: AppSocketMessage | null;
  sessions: SessionWithProvider[];
  selectedSession: ProjectSession | null;
  initialSessionsLoaded: boolean;
  hasMoreSessions: boolean;
  isLoadingMoreSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  orchestratorTree?: SessionTreeNode[];
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  onLoadMoreSessions: (projectId: string) => void;
  onNewSession: (project: Project) => void;
  t: TFunction;
};

export default function SidebarProjectSessions({
  project,
  isExpanded,
  latestMessage,
  selectedSession,
  onSessionSelect,
  t,
}: SidebarProjectSessionsProps) {
  const { tree: projectSessionTree } = useSessionTree(
    isExpanded ? project.projectId : null,
    latestMessage,
  );

  if (!isExpanded) {
    return null;
  }

  const hasOrchTree = projectSessionTree.length > 0;

  return (
    <div className="ml-3 space-y-1 border-l border-border pl-3">
      {hasOrchTree && (
        <SidebarSessionTree
          nodes={projectSessionTree}
          selectedSessionId={getSessionOrchestratorId(selectedSession) ?? selectedSession?.id ?? null}
          onSelect={(node: SessionTreeNode) => {
            onSessionSelect({ ...node, __projectId: project.projectId, __provider: node.provider ?? undefined } as any, project.displayName);
          }}
        />
      )}

      {!hasOrchTree ? (
        <div className="px-3 py-2 text-left">
          <p className="text-xs text-muted-foreground">
            {t('sessions.noSessions', { defaultValue: 'No role sessions yet' })}
          </p>
        </div>
      ) : null}
    </div>
  );
}
