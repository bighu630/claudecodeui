# Role Session Architecture

## Purpose

This document is the handoff entry point for agents working on the role-based session orchestrator.

Focus here:

- how the project is layered
- how orchestrator sessions relate to provider runtimes
- what was recently implemented
- what is still being stabilized
- where to look when behavior is wrong

This is not a generic product overview. It is an engineering map for taking over the codebase quickly.

## Current Direction

The project is moving from provider-native sessions as the main UI/session model toward role-based orchestrator sessions as the primary business object.

Current target model:

- one project owns a role session tree
- users navigate role sessions, not provider buckets
- provider sessions remain runtime infrastructure
- each role session may bind to one provider runtime today via `external_session_id`

The long-term direction still points toward runtime bindings as a separate model, but the current implementation uses `orchestrator_sessions.external_session_id` as the active runtime binding field.

## Project Structure

### Frontend

- `src/components/sidebar/view/subcomponents/SidebarSessionTree.tsx`
  - role-tree UI in the sidebar
- `src/components/sidebar/view/subcomponents/SidebarProjectSessions.tsx`
  - project session rendering entry
- `src/components/chat/hooks/useChatComposerState.ts`
  - sends provider commands over websocket
  - includes `orchestratorSessionId` when the selected session is orchestrator-backed
- `src/components/chat/utils/orchestratorSessionConfig.ts`
  - resolves provider/model for orchestrator sessions
- `src/hooks/useProjectsState.ts`
  - normalizes backend sessions into frontend `ProjectSession`
  - maps `orchestratorSessionId` vs `runtimeSessionId`
- `src/components/app/AppContent.tsx`
  - uses runtime session id to request pending permissions
- `src/components/main-content/view/subcomponents/SessionPanel.tsx`
  - quick debug surface for orchestrator session fields
- `src/types/app.ts`
  - frontend session shape; includes `orchestratorSessionId`, `runtimeSessionId`, `external_session_id`

### Backend

- `server/modules/orchestrator/orchestrator.service.ts`
  - main orchestrator domain service
  - session creation, tree reads, bootstrap, child materialization, runtime binding, auto-run
- `server/modules/orchestrator/orchestrator.routes.ts`
  - orchestrator HTTP API
- `server/modules/orchestrator/prompts.ts`
  - role prompts and startup message templates
- `server/modules/projects/services/project-management.service.ts`
  - project creation entry; now also boots orchestrator roots
- `server/modules/projects/services/project-clone.service.ts`
  - clone flow; now routes through project creation/bootstrap
- `server/modules/projects/services/projects-with-sessions-fetch.service.ts`
  - project list read model; still contains provider-bucket compatibility data
- `server/modules/projects/project-role-config.ts`
  - per-role provider/model config shape

### Provider dispatch and runtime glue

- `server/modules/websocket/services/chat-websocket.service.ts`
  - websocket message dispatcher
  - routes `claude-command`, `cursor-command`, `codex-command`, `gemini-command`
- `server/claude-sdk.js`
- `server/cursor-cli.js`
- `server/openai-codex.js`
- `server/gemini-cli.js`
- `server/gemini-response-handler.js`
  - provider/runtime execution layer
  - all integrate with orchestrator via `prepareOrchestratorCommand`, `bindExternalSessionId`, `materializeAndBindChildSessionFromTool`, `bindChildRuntimeFromTool`, `finalizeOrchestratorRun`

### Database and websocket support

- `server/modules/database/schema.ts`
  - `orchestrator_sessions`
  - `worker_task_specs`
  - `session_events`
  - `project_role_model_configs`
- `server/modules/database/migrations.ts`
  - orchestrator schema/index maintenance
- `server/modules/database/repositories/projects.db.ts`
  - project metadata and per-role model config persistence
- `server/modules/websocket/README.md`
  - websocket command flow reference

## System Layering

The orchestrator stack currently has four layers:

1. Project/bootstrap layer
   - create project
   - ensure project knowledge
   - ensure root sessions exist

2. Orchestrator session layer
   - logical role sessions in `orchestrator_sessions`
   - parent/child structure
   - role prompts
   - lifecycle and run status

3. Provider runtime layer
   - provider-native session/thread/agent ids
   - stored today in `external_session_id`
   - used for resume, transcript sync, permission recovery

4. Frontend projection layer
   - turns one backend orchestrator session into a `ProjectSession`
   - surfaces both logical id and runtime id

The most important design constraint is that orchestrator session identity and provider runtime identity are different concepts, even when the frontend temporarily needs both on one object.

## Role-Based Session Tree

### Fixed roots per project

Each project must have exactly one active root:

- `tech_lead`
- `ops`

Bootstrap happens through:

- `ensureProjectOrchestratorBootstrap()` in `server/modules/orchestrator/orchestrator.service.ts`
- called from `createProject()` in `server/modules/projects/services/project-management.service.ts`
- clone flow reaches the same path through `server/modules/projects/services/project-clone.service.ts`

### Allowed derivation

The current tree is intentionally strict:

- `tech_lead -> feature_lead`
- `feature_lead -> worker`
- `worker -> no children`
- `ops -> no children`

Hard constraints live in `validateSessionCreation()` and `canCreateChild()` in `server/modules/orchestrator/orchestrator.service.ts`.

This is not a generic agent tree. Do not generalize it casually without revisiting prompts, UI, lifecycle rules, and DB invariants together.

### Role boundaries

Prompt definitions are in `server/modules/orchestrator/prompts.ts`.

- `tech_lead`
  - feasibility, architecture, constraints, handoff to `feature_lead`
- `feature_lead`
  - code-aware planning, implementation ownership, task decomposition, worker coordination
- `worker`
  - execution-only against a task spec
- `ops`
  - deployment/environment/infra support, no child creation

## Why Child Sessions Start Empty

Current prompt rules explicitly say child sessions should start as empty sessions and receive only the minimum necessary handoff context.

Reasoning:

- full-context fork causes role bleed
- child role behavior should be determined by its own prompt and scoped task, not by inherited chat history
- model/provider choice should follow child role config, not parent runtime defaults
- smaller startup payload makes re-entry and debugging clearer

Practical effect:

- parent passes goal, constraints, task spec, and selected context
- child runtime is not expected to inherit the full parent conversation transcript

This rule is encoded in role prompts in `server/modules/orchestrator/prompts.ts`.

## Session Model vs Runtime Model

### Orchestrator session id

The orchestrator session id is `orchestrator_sessions.id`.

It represents:

- the business-visible role session
- tree structure
- prompt/role identity
- status and summaries
- worker task ownership

### Runtime session id

The runtime id is currently stored in `orchestrator_sessions.external_session_id`.

It represents the provider-native runtime:

- Claude session id
- Codex session id
- Cursor session id
- Gemini session/thread/agent id depending on provider behavior

### Frontend mapping

`src/hooks/useProjectsState.ts` normalizes orchestrator sessions like this:

- `orchestratorSessionId = session.id`
- `runtimeSessionId = session.external_session_id`
- `id = runtimeSessionId || session.id`

This is a compatibility compromise:

- UI selection and websocket operations still often need the runtime id
- orchestrator-aware views should prefer `orchestratorSessionId`

`src/components/chat/utils/orchestratorSessionConfig.ts` resolves provider/model from the orchestrator session first, then falls back to provider defaults for legacy provider sessions.

### Runtime lookup API

`GET /api/orchestrator/runtime/:externalSessionId` in `server/modules/orchestrator/orchestrator.routes.ts` maps runtime id back to the owning orchestrator session.

That route is important when debugging mismatches between provider activity and sidebar session tree state.

## Core Runtime Chain

### User-driven path

1. Frontend selects a session.
2. `useChatComposerState.ts` sends one of:
   - `claude-command`
   - `cursor-command`
   - `codex-command`
   - `gemini-command`
3. `chat-websocket.service.ts` dispatches to the matching provider runner.
4. Provider runner calls `prepareOrchestratorCommand(orchestratorSessionId, userCommand)` when `orchestratorSessionId` is present.
5. Provider runtime starts or resumes.
6. When a provider-native runtime id is discovered, the provider runner calls `bindExternalSessionId(orchestratorSessionId, runtimeId)`.
7. Run completion goes through `finalizeOrchestratorRun(...)`.

### Child-session path

1. Parent provider emits a delegation tool event.
2. Provider integration calls `materializeAndBindChildSessionFromTool(parentSessionId, ...)`.
3. Orchestrator creates a child logical session from the tool payload.
4. If the same tool event already includes a child runtime id, `external_session_id` is written immediately.
5. If no runtime id is available, the orchestrator queues child auto-run.
6. Auto-run executes the child startup message against the child session's provider/model.
7. Provider startup should bind runtime id and transition to `running`.

The child-session path is the main area still under active stabilization.

## Current Completed Work

### 1. Project bootstrap is unified

Done in:

- `server/modules/orchestrator/orchestrator.service.ts`
- `server/modules/projects/services/project-management.service.ts`

Current behavior:

- creating a project ensures `project_knowledge`
- creating a project ensures exactly one root `tech_lead`
- creating a project ensures exactly one root `ops`

### 2. Clone now gets orchestrator bootstrap

Done in:

- `server/modules/projects/services/project-clone.service.ts`

Current behavior:

- clone no longer bypasses orchestrator initialization
- cloned projects reach the same root-session bootstrap path as normal project creation

### 3. Role tree hard constraints were added

Done in:

- `canCreateChild()`
- `resolveSessionParent()`
- `validateSessionCreation()`

Current behavior:

- `worker` cannot be root
- `feature_lead` cannot be root
- `tech_lead` and `ops` cannot be created as child sessions
- parent/child derivation is enforced in service logic

### 4. Child `external_session_id` can bind immediately

Done in:

- `materializeAndBindChildSessionFromTool()`
- `bindChildRuntimeFromTool()`

Current behavior:

- if delegation returns a child runtime id in the same event payload, the orchestrator writes `external_session_id` immediately
- later `tool_result` binding still exists as a fallback/completion path

This closed the earlier gap where child sessions existed in DB but remained invisible because runtime binding only happened later or not at all.

### 5. Child sessions default to child role model config

Done in:

- `createSession()`
- `deriveExplicitProvider()`
- `deriveExplicitModel()`
- `materializeChildSessionFromTool()`

Current behavior:

- child session creation does not blindly inherit parent `provider/model`
- explicit tool payload provider/model can override
- otherwise the session resolves through `project_role_model_configs`

This matters because empty child sessions and independent role prompts only make sense if the runtime is also role-specific.

## Active Work / Still Needs Confirmation

### 1. Child session auto-start must be validated end-to-end

Relevant code:

- `queueChildSessionAutoRun()`
- `autoRunSession()`
- `defaultChildSessionAutoRunExecutor()`

Current state:

- there is now a first-pass implementation in `orchestrator.service.ts`
- it invokes provider runners directly for auto-run child sessions
- tests exist for the service-level behavior

Still needs confirmation:

- real provider process startup from child delegation
- runtime id binding across all providers
- UI visibility and state transitions under actual websocket/runtime timing

### 2. `run_status` must match real runtime state

Watch for premature transitions.

Important places:

- `prepareOrchestratorCommand()`
- `bindChildRuntimeFromTool()`
- `finalizeOrchestratorRun()`

What to verify:

- `queued` before provider starts
- `running` only after runtime is actually started or bound
- `idle` only after completion/failure is finalized

This area has improved, but it is still easy for the orchestrator to look active before the provider runtime is actually alive.

### 3. Tree visibility for pending runtime is still a product decision

Current behavior:

- `isSessionVisibleInTree()` hides `feature_lead` sessions with no `external_session_id`

Implication:

- a child feature session can exist in DB but remain invisible until runtime binding succeeds

Open question:

- should pending feature sessions be hidden
- or shown as `pending runtime`

If the product wants better observability during orchestration debugging, this visibility rule is the first place to change.

### 4. Read model is still partly hybrid

`projects-with-sessions-fetch.service.ts` still serves provider-bucket session lists for compatibility.

That means the product is not yet fully orchestrator-first in all views and fetch paths. When debugging project/session selection bugs, always check whether the screen is consuming:

- provider buckets
- normalized orchestrator sessions
- or both

## Database Model and Debugging

### Key tables

- `orchestrator_sessions`
  - role session source of truth
- `worker_task_specs`
  - execution contract for workers
- `session_events`
  - event log for creation, status changes, task creation, child materialization
- `project_role_model_configs`
  - default provider/model per role per project
- `sessions`
  - provider-native session history table used by legacy/runtime sync flows

### Key fields in `orchestrator_sessions`

- `id`
  - logical orchestrator session id
- `project_id`
- `parent_id`
- `provider`
- `model`
- `type`
- `interaction_mode`
- `lifecycle_status`
- `run_status`
- `external_session_id`
- `goal_and_constraints`
- `workspace_path`
- `auto_run`

### Useful event types in `session_events`

- `session_created`
- `child_session_created`
- `status_changed`
- `task_spec_created`
- `archived`

## How To Tell What Broke

### Case 1: child session row exists, but no provider was started

Check:

- `orchestrator_sessions.external_session_id` is `NULL`
- `run_status` may still be `queued`
- `session_events` has `child_session_created`
- no later `status_changed` carrying `external_session_id`

Code paths to inspect:

- `materializeAndBindChildSessionFromTool()`
- `queueChildSessionAutoRun()`
- `autoRunSession()`
- provider runner invocation in `defaultChildSessionAutoRunExecutor()`

This is the main signature of "built the logical record but never really launched the child runtime."

### Case 2: provider started, but binding did not reach orchestrator

Check:

- provider logs/runtime show a child runtime id exists
- `orchestrator_sessions.external_session_id` is still `NULL`
- `session_events` lacks a binding `status_changed`

Code paths to inspect:

- provider-specific event parsing in:
  - `server/claude-sdk.js`
  - `server/cursor-cli.js`
  - `server/openai-codex.js`
  - `server/gemini-response-handler.js`
- `extractRuntimeSessionId()`
- `bindChildRuntimeFromTool()`
- `bindExternalSessionId()`

This usually means the provider emitted a session/thread/agent id in a shape the orchestrator did not capture.

### Case 3: runtime bound, but session is still missing from the tree

Check:

- `orchestrator_sessions.external_session_id` is populated
- session type is `feature_lead`
- `getSessionTree()` still does not include it

Code paths to inspect:

- `isSessionVisibleInTree()`
- frontend normalization in `src/hooks/useProjectsState.ts`
- sidebar tree rendering components

### Case 4: child used the wrong model

Check:

- `orchestrator_sessions.provider/model`
- project defaults in `project_role_model_configs`
- whether delegation payload explicitly passed `provider/model`

Code paths to inspect:

- `createSession()`
- `deriveExplicitProvider()`
- `deriveExplicitModel()`
- `materializeChildSessionFromTool()`

If a child is still using the parent runtime model without explicit override, this is a regression.

## Engineering Notes For New Agents

1. Treat `orchestrator_sessions.id` and `external_session_id` as separate identities.
2. Do not assume provider session lists are gone; the codebase is still in transition.
3. Do not loosen role derivation rules unless you are also updating prompt policy, API, UI tree rules, and tests.
4. When fixing child session behavior, inspect both service logic and provider adapters; bugs often sit at the boundary.
5. Tests for current orchestrator behavior live in:
   - `server/modules/orchestrator/orchestrator.service.integration.test.ts`
   - `server/modules/projects/tests/project-clone.service.test.ts`
   - `server/modules/projects/tests/project-management.service.test.ts`

## Follow-up Work Likely Next

In practical priority order:

1. finish validating child auto-run against real providers
2. make `run_status` transitions strictly reflect provider startup/completion timing
3. decide whether pending `feature_lead` sessions should appear in the tree
4. continue moving project/session reads from provider-bucket compatibility toward orchestrator-first reads

---

## Frontend Session Selection Flow (2026-05-26)

### Project data does not carry orchestrator sessions

`GET /api/projects` returns only provider-bucketed sessions (claude/cursor/codex/gemini) via `projects-with-sessions-fetch.service.ts`. Orchestrator sessions are fetched separately through `GET /api/orchestrator/projects/:projectId/tree`.

This separation means the frontend cannot rely on project data to know whether orchestrator root sessions exist for a project.

### Orchestrator tree is loaded lazily in the sidebar

`SidebarProjectSessions.tsx` calls `useSessionTree(projectId)` only when the project is expanded. The tree data is not part of the initial project list payload. This means tree availability is gated on user interaction (expanding a project) and cannot be assumed at the time of project selection.

### Project click auto-navigates to tech_lead

`handleProjectSelect` in `useProjectsState.ts` now fetches the orchestrator tree asynchronously after setting the project. Behavior:

- If the tree contains `tech_lead` → auto-select and navigate to it.
- If no `tech_lead` but `ops` exists → auto-select and navigate to ops.
- If no root at all → clear `selectedProject` to show global empty state (not the "new session" page).
- Network error → silently remain on current page.
- Race guard via `latestProjectSelectRef` prevents stale responses from overwriting a newer project selection.

### Two distinct empty states

`MainContent.tsx` has two no-session states that look different to the user:

1. **Global empty**: `selectedProject === null` → `MainContentStateView mode="empty"`. Shows when no project is selected at all.
2. **New session page**: `selectedProject !== null` but `selectedSession === null` → ChatInterface renders its "start new chat" UI. This is the legacy "new session" entry point.

The project-click fix above deliberately routes to state 1 (global empty) when orchestrator roots are absent, rather than leaving the user on state 2.

---

## DB Access Separation (2026-05-27)

### Problem

`orchestrator.service.ts` (1285 lines) contains ~81 direct database operations spanning four tables: `orchestrator_sessions`, `project_knowledge`, `worker_task_specs`, and `session_events`. The service uses a local `getDb()` wrapper and inline SQL throughout, while the rest of the codebase follows a repository pattern under `server/modules/database/repositories/`.

### Target state

Orchestrator DB operations should live in a dedicated repository `orchestrator-sessions.db.ts`, following the same `export const xyzDb = { ... }` pattern used by `projects.db.ts` and `sessions.db.ts`. The service layer should call repository methods and focus on business logic (validation, tree building, sorting, auto-run orchestration).

### Repository scope

The new repository should cover:

- `orchestrator_sessions` CRUD, tree queries, status updates, runtime binding, descendant config sync
- `project_knowledge` read/write
- `worker_task_specs` create/query
- `session_events` record/query
- Tool call payload queries

Existing imports from `projectsDb` (e.g., `getProjectRoleModelConfig`) stay in the service layer.
