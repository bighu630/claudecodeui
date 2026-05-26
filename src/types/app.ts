export type LLMProvider = 'claude' | 'cursor' | 'codex' | 'gemini';
export type ProjectRoleType = 'tech_lead' | 'feature_lead' | 'worker' | 'ops';
export type ProjectRoleModelConfigEntry = {
  provider: LLMProvider;
  model: string;
};
export type ProjectRoleModelConfig = Record<ProjectRoleType, ProjectRoleModelConfigEntry>;

export type AppTab = 'chat' | 'files' | 'shell' | 'git' | 'tasks' | 'preview' | 'session-panel' | `plugin:${string}`;

export interface ProjectSession {
  /**
   * Primary session identity for UI routing, selection, message loading, and
   * provider resume. This should be the provider/runtime conversation id when
   * one exists. For uninitialized orchestrator sessions it can temporarily
   * fall back to the orchestrator session id until a provider runtime exists.
   */
  id: string;
  /**
   * Auxiliary orchestrator-local session id. Keep for tree/detail/initialize
   * lookups only; it is not the primary conversation id.
   */
  orchestratorSessionId?: string | null;
  /**
   * Backend compatibility mirror for orchestrator payloads. Use `id` for the
   * main provider/runtime identity in frontend code.
   */
  runtime_session_id?: string | null;
  title?: string;
  summary?: string;
  name?: string;
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number;
  __provider?: LLMProvider;
  // Tags the session with the owning project's DB `projectId` so UI handlers
  // (session switching, sidebar focus, etc.) can match against selectedProject.
  __projectId?: string;
  [key: string]: unknown;
}

export interface ProjectSessionMeta {
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

export interface ProjectTaskmasterInfo {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

// After the projectName → projectId migration the backend no longer returns a
// folder-derived `name` string. Projects are now addressed everywhere by the
// DB-assigned `projectId` (primary key in the `projects` table), and the UI
// uses the same identifier for routing, state keys and API calls.
export interface Project {
  projectId: string;
  displayName: string;
  fullPath: string;
  path?: string;
  isStarred?: boolean;
  roleModelConfig?: ProjectRoleModelConfig;
  sessions?: ProjectSession[];
  cursorSessions?: ProjectSession[];
  codexSessions?: ProjectSession[];
  geminiSessions?: ProjectSession[];
  sessionMeta?: ProjectSessionMeta;
  taskmaster?: ProjectTaskmasterInfo;
  [key: string]: unknown;
}

export interface LoadingProgress {
  type?: 'loading_progress';
  phase?: string;
  current: number;
  total: number;
  currentProject?: string;
  [key: string]: unknown;
}

export interface ProjectsUpdatedMessage {
  type: 'projects_updated';
  projects: Project[];
  updatedSessionId?: string;
  updatedSessionIds?: string[];
  watchProvider?: LLMProvider;
  watchProviders?: LLMProvider[];
  changeType?: 'add' | 'change';
  changeTypes?: Array<'add' | 'change'>;
  batched?: boolean;
  [key: string]: unknown;
}

export interface LoadingProgressMessage extends LoadingProgress {
  type: 'loading_progress';
}

export type AppSocketMessage =
  | LoadingProgressMessage
  | ProjectsUpdatedMessage
  | { type?: string;[key: string]: unknown };

// ─── Orchestrator types ───

export type SessionType = 'tech_lead' | 'feature_lead' | 'worker' | 'ops';

export type LifecycleStatus = 'active' | 'completed' | 'failed' | 'archived';

export type RunStatus = 'idle' | 'queued' | 'running' | 'waiting_input' | 'blocked';

export type InteractionMode = 'conversational' | 'managed';

export interface OrchestratorSession {
  id: string;
  project_id: string;
  parent_id: string | null;
  provider: LLMProvider | null;
  model: string | null;
  type: SessionType;
  title: string;
  interaction_mode: InteractionMode;
  lifecycle_status: LifecycleStatus;
  run_status: RunStatus;
  runtime_session_id: string | null;
  system_prompt: string;
  role_prompt: string;
  project_knowledge_snapshot: string;
  goal_and_constraints: string;
  workspace_path: string | null;
  auto_run: number;
  summary_text: string;
  last_run_summary: string;
  last_error_summary: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface SessionTreeNode extends OrchestratorSession {
  children: SessionTreeNode[];
}

export interface WorkerTaskSpec {
  id: string;
  worker_session_id: string;
  title: string;
  objective: string;
  scope: string;
  constraints: string;
  input_context: string;
  expected_output: string;
  acceptance_criteria: string;
  created_by_session_id: string;
  created_at: string;
}

export interface SessionTreeResponse {
  tree: SessionTreeNode[];
}

export interface SessionDetailResponse {
  session: OrchestratorSession;
  taskSpec: WorkerTaskSpec | null;
  events: Array<{ id: string; event_type: string; payload_json: string; created_at: string }>;
}
