import { ChevronDown, ChevronRight, Wrench, User, Users, Bot } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { cn } from '../../../../lib/utils';
import type { SessionTreeNode, SessionType } from '../../../../types/app';

const ROLE_ICONS: Record<SessionType, typeof User> = {
  tech_lead: User,
  feature_lead: Users,
  worker: Bot,
  ops: Wrench,
};

const ROLE_LABELS: Record<SessionType, string> = {
  tech_lead: 'Tech Lead',
  feature_lead: 'Feature Lead',
  worker: 'Subagent',
  ops: 'Ops',
};

const RUN_STATUS_COLORS: Record<string, string> = {
  idle: 'bg-gray-400',
  queued: 'bg-yellow-400',
  running: 'bg-green-400 animate-pulse',
  waiting_input: 'bg-blue-400',
  blocked: 'bg-red-400',
};

interface Props {
  nodes: SessionTreeNode[];
  selectedSessionId: string | null;
  onSelect: (session: SessionTreeNode) => void;
}


/** Mirror of the server-side sort: running first, then created_at ascending. */
function sortTreeNodes(nodes: SessionTreeNode[]): SessionTreeNode[] {
  return [...nodes].sort((a, b) => {
    const aRunning = a.run_status === 'running' ? 0 : 1;
    const bRunning = b.run_status === 'running' ? 0 : 1;
    if (aRunning !== bRunning) return aRunning - bRunning;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  }).map(node => ({
    ...node,
    children: node.children.length > 0 ? sortTreeNodes(node.children) : node.children,
  }));
}

function collectDefaultExpandedIds(nodes: SessionTreeNode[]): Set<string> {
  const expandedIds = new Set<string>();

  const visit = (nodeList: SessionTreeNode[]) => {
    for (const node of nodeList) {
      if (node.children.length > 0 && node.type !== 'worker') {
        expandedIds.add(node.id);
      }
      visit(node.children);
    }
  };

  visit(nodes);
  return expandedIds;
}

function collectAncestorIds(nodes: SessionTreeNode[], targetId: string): string[] {
  const path: string[] = [];

  const visit = (nodeList: SessionTreeNode[], ancestors: string[]): boolean => {
    for (const node of nodeList) {
      if (node.id === targetId) {
        path.push(...ancestors);
        return true;
      }

      if (visit(node.children, [...ancestors, node.id])) {
        return true;
      }
    }

    return false;
  };

  visit(nodes, []);
  return path;
}

export default function SidebarSessionTree({ nodes, selectedSessionId, onSelect }: Props) {
  const defaultExpandedIds = useMemo(() => collectDefaultExpandedIds(nodes), [nodes]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(defaultExpandedIds);
  const sortedNodes = useMemo(() => sortTreeNodes(nodes), [nodes]);

  useEffect(() => {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      for (const id of defaultExpandedIds) {
        next.add(id);
      }
      return next;
    });
  }, [defaultExpandedIds]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    const ancestorIds = collectAncestorIds(nodes, selectedSessionId);
    if (ancestorIds.length === 0) {
      return;
    }

    setExpandedIds((previous) => {
      const next = new Set(previous);
      let changed = false;
      for (const id of ancestorIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [nodes, selectedSessionId]);

  const toggleExpanded = (sessionId: string) => {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  return (
    <div className="space-y-0.5">
      {sortedNodes.map(node => (
        <SessionTreeNodeItem
          key={node.id}
          node={node}
          selectedSessionId={selectedSessionId}
          onSelect={onSelect}
          level={0}
          expandedIds={expandedIds}
          onToggleExpanded={toggleExpanded}
        />
      ))}
    </div>
  );
}

function SessionTreeNodeItem({
  node,
  selectedSessionId,
  onSelect,
  level = 0,
  expandedIds,
  onToggleExpanded,
}: {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  onSelect: (session: SessionTreeNode) => void;
  level?: number;
  expandedIds: Set<string>;
  onToggleExpanded: (sessionId: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const expanded = expandedIds.has(node.id);
  const isSelected = selectedSessionId === node.id;
  const Icon = ROLE_ICONS[node.type] || Bot;

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-sm hover:bg-accent/50',
          isSelected && 'bg-accent text-accent-foreground',
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => onSelect(node)}
      >
        {hasChildren ? (
          <button
            type="button"
            className="flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent"
            aria-label={expanded ? 'Collapse session branch' : 'Expand session branch'}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded(node.id);
            }}
          >
            {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          </button>
        ) : (
          <span className="w-3" />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{node.title}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{ROLE_LABELS[node.type]}</span>
        {!node.provider && <span className="ml-1 shrink-0 text-[10px] text-yellow-500">未配置</span>}
        <span className={cn('h-2 w-2 rounded-full shrink-0', RUN_STATUS_COLORS[node.run_status] || 'bg-gray-400')} />
      </div>
      {expanded && hasChildren && (
        <div className="space-y-0.5">
          {node.children.map((childNode) => (
            <SessionTreeNodeItem
              key={childNode.id}
              node={childNode}
              selectedSessionId={selectedSessionId}
              onSelect={onSelect}
              level={level + 1}
              expandedIds={expandedIds}
              onToggleExpanded={onToggleExpanded}
            />
          ))}
        </div>
      )}
    </div>
  );
}
