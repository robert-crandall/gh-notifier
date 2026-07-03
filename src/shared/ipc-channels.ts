// IPC channel definitions — shared between main process and renderer.
// All channels follow the naming pattern:  domain:action
//
// Each entry maps a channel name to its argument tuple and return type.
// Main registers handlers with ipcMain.handle(channel, ...).
// Renderer calls via window.electron.ipc.invoke(channel, ...args).

// ── Domain types ─────────────────────────────────────────────────────────────

export type AuthStatus =
  | { authenticated: false }
  | { authenticated: true; login: string; avatarUrl: string }

export type ProjectStatus = 'active' | 'snoozed'

export type SnoozeMode = 'manual' | 'date' | 'notification'

/**
 * Peripheral-memory state of a project relative to the user's attention.
 * - `parked`: intentionally snoozed. Quiet.
 * - `drifting`: active but not returned to for a while — gently resurfaced.
 * - `active`: normal.
 */
export type DriftState = 'active' | 'parked' | 'drifting'

/** Valid background sync intervals, in minutes. */
export type SyncIntervalMinutes = 5 | 15 | 30 | 60
export const SYNC_INTERVAL_OPTIONS: SyncIntervalMinutes[] = [5, 15, 30, 60]
export const DEFAULT_SYNC_INTERVAL_MINUTES: SyncIntervalMinutes = 5

/** Maximum number of days to look back when fetching notifications. */
export type MaxSyncDays = 1 | 3 | 7 | 14 | 30
export const MAX_SYNC_DAYS_OPTIONS: MaxSyncDays[] = [1, 3, 7, 14, 30]
export const DEFAULT_MAX_SYNC_DAYS: MaxSyncDays = 7

// ── Copilot session types ─────────────────────────────────────────────────────

export type CopilotSessionStatus =
  | 'in_progress'  // agent is actively working
  | 'waiting'      // agent finished a turn, waiting for user input
  | 'pr_ready'     // PR opened and ready for review (github source only)
  | 'completed'    // issue closed, PR merged, or session timed out

export type CopilotSessionSource = 'github'

export interface CopilotSession {
  id: string                     // gh agent-task UUID
  projectId: number | null       // null = unlinked
  source: CopilotSessionSource
  status: CopilotSessionStatus
  title: string
  htmlUrl: string | null         // link to issue/PR on github.com
  startedAt: string              // ISO 8601
  updatedAt: string              // ISO 8601
  repoOwner: string | null
  repoName: string | null
  branch: string | null          // reserved for future use
  linkedPrUrl: string | null     // PR opened by Copilot for this task
  /**
   * Sticky project assignment set by launching from a project or manually
   * assigning an unassigned session. When set (and the project is live), it
   * resists re-resolution on the next `gh agent-task list` sync so a launched
   * task doesn't jump to the Unassigned surface. Null = follow auto-resolution.
   */
  pinnedProjectId: number | null
}

/** Payload to launch a cloud `gh agent-task`. */
export interface LaunchAgentTaskPayload {
  /** The task description handed to Copilot. */
  prompt: string
  repoOwner: string
  repoName: string
  /** Base branch for the PR; defaults to the repo's default branch when omitted. */
  baseBranch?: string
  /** Originating project, pinned so the launched session stays co-located. Null = no project. */
  projectId: number | null
}

/** A repo a project's agent task can target, resolved from repo rules + threads. */
export interface LaunchTarget {
  repoOwner: string
  repoName: string
}

export interface Project {
  id: number
  name: string
  notes: string
  nextAction: string
  status: ProjectStatus
  sortOrder: number
  createdAt: string
  updatedAt: string
  unreadCount: number
  activeTodoCount: number
  snoozeMode: SnoozeMode | null
  snoozeUntil: string | null
  /** Highest-priority Copilot session status across all sessions for this project. Null if none. */
  copilotStatus: CopilotSessionStatus | null
  /** ISO 8601 UTC of the last time this project was focused. Null until first focused. */
  lastFocusedAt: string | null
  /** Peripheral-memory classification used by the rail + resurfacing. */
  driftState: DriftState
}

// ── Re-entry digest types ─────────────────────────────────────────────────────

/** Category of a digest bullet; the renderer maps this to a Lucide icon. */
export type DigestItemKind =
  | 'agent-pr-ready'
  | 'agent-waiting'
  | 'agent-completed'
  | 'agent-in-progress'
  | 'notification-review'
  | 'notification-activity'
  | 'notifications-grouped'

/** Semantic tone for a digest bullet; the renderer maps this to a color token. */
export type DigestItemTone = 'info' | 'success' | 'attention' | 'danger' | 'violet' | 'neutral'

export interface DigestItem {
  /** Stable key for React lists. */
  id: string
  kind: DigestItemKind
  tone: DigestItemTone
  /** Blame-free, scannable copy. */
  text: string
  /** Optional deep link (PR/issue html_url). Null when there's nothing to open. */
  href: string | null
  /** Count for grouped items (e.g. "3 notifications"), else null. */
  count: number | null
}

export interface ReentryDigest {
  projectId: number
  /**
   * ISO 8601 UTC upper bound the digest was computed against (the query time).
   * Passed back to `digest:dismiss` so dismissing can't mark later work as seen.
   */
  asOf: string
  items: DigestItem[]
}

// ── Notification types ────────────────────────────────────────────────────────

export type NotificationType = 'PullRequest' | 'Issue' | 'Release' | 'Discussion' | 'Commit' | 'CheckSuite'
export type SubjectState = 'open' | 'closed' | 'merged'

export interface NotificationThread {
  id: string
  projectId: number | null
  repoOwner: string
  repoName: string
  title: string
  type: NotificationType
  reason: string
  unread: boolean
  updatedAt: string
  lastReadAt: string | null
  apiUrl: string
  /** GitHub API URL for the PR/Issue subject. Available from initial sync. */
  subjectUrl: string | null
  /** Resolved state from content prefetch: 'open', 'closed', or 'merged'. Null until fetched. */
  subjectState: SubjectState | null
  /** Direct browser URL for the PR/Issue. Null until content is prefetched. */
  htmlUrl: string | null
}

/** Suggestion offered to the user after assigning a thread to a project. */
export type RepoRuleSuggestionType = 'opt-in' | 'opt-out'

export interface RepoRuleSuggestion {
  type: RepoRuleSuggestionType
  repoOwner: string
  repoName: string
  projectId: number
  projectName: string
}

export interface RepoRule {
  id: number
  repoOwner: string
  repoName: string
  projectId: number
  createdAt: string
}

export interface UnreadCount {
  projectId: number
  count: number
}

export type ProjectPatch = Partial<Pick<Project, 'name' | 'notes' | 'nextAction' | 'status' | 'sortOrder'>>

export interface ProjectTodo {
  id: number
  projectId: number
  text: string
  done: boolean
  sortOrder: number
  createdAt: string
}

export type ProjectTodoPatch = Partial<Pick<ProjectTodo, 'text' | 'done' | 'sortOrder'>>

export interface ProjectLink {
  id: number
  projectId: number
  label: string
  url: string
  sortOrder: number
}

export type ProjectLinkPatch = Partial<Pick<ProjectLink, 'label' | 'url' | 'sortOrder'>>

export interface ProjectDetail extends Project {
  todos: ProjectTodo[]
  links: ProjectLink[]
}

// ── Routing rule types ────────────────────────────────────────────────────────

export type RoutingRuleAction = 'route' | 'suppress'

/**
 * A routing rule routes matching inbox threads to a specific project,
 * or suppresses them from all views (hide).
 * All non-null match_* conditions must match (AND semantics).
 * Rules are evaluated in creation order; the first match wins.
 */
export interface RoutingRule {
  id: number
  action: RoutingRuleAction
  projectId: number | null
  projectName: string | null
  matchType: string | null
  matchReason: string | null
  matchRepoOwner: string | null
  matchRepoName: string | null
  matchOrg: string | null
  createdAt: string
}

export interface CreateRoutingRulePayload {
  action: RoutingRuleAction
  /** Required when action='route'. */
  projectId?: number
  matchType?: string
  matchReason?: string
  matchRepoOwner?: string
  matchRepoName?: string
  matchOrg?: string
}

// ── Resource registry / project brain (MVP C) ─────────────────────────────────

/** Typed kind of a saved resource. */
export type ResourceKind = 'dashboard' | 'metric_query' | 'saved_search' | 'doc' | 'link'

/** How a resource record entered the registry. */
export type ResourceProvenance = 'captured' | 'manual' | 'imported' | 'agent'

/** Health of a resource's executable query, updated as a byproduct of use. */
export type ResourceValidationState = 'unverified' | 'valid' | 'invalid' | 'no_data'

/**
 * A typed resource record. Each dashboard / saved query / doc / link is one of
 * these, not a bookmark. Retrieved on demand by the resolver, never all injected.
 */
export interface Resource {
  id: number
  projectId: number
  title: string
  kind: ResourceKind
  /** Tool/system the source lives in (e.g. 'datadog', 'splunk', 'github', 'generic'). */
  source: string
  service: string
  env: string
  /** Machine-derived structured disambiguation attributes (namespace/cluster/system/team/…). */
  tags: Record<string, string>
  /** Human fallback link. Null when the source is a pure executable query. */
  url: string | null
  description: string
  /** Alias/glossary terms that bridge fuzzy language to this record. */
  aliases: string[]
  provenance: ResourceProvenance
  confidence: number
  lastUsed: string | null
  lastVerified: string | null
  failureCount: number
  /** True when the source itself is suspect (a query that 400'd / returned no-data). */
  suspect: boolean
  /** Rare, visible browse override (pin/rename a computed group). Null = auto. */
  pinnedGroup: string | null
  /** Id of the wired per-project MCP server. Null = no live source. */
  mcpServer: string | null
  toolName: string | null
  /** Args passed to the MCP tool. */
  toolArgs: Record<string, unknown> | null
  /** Source-native id (dashboard id, saved-search id, …). */
  externalRef: string | null
  validationState: ResourceValidationState
  lastErrorCode: string | null
  lastErrorMessage: string | null
  createdAt: string
  updatedAt: string
}

/** Fields accepted when creating a resource. Everything but title is optional. */
export interface ResourceInput {
  title: string
  kind?: ResourceKind
  source?: string
  service?: string
  env?: string
  tags?: Record<string, string>
  url?: string | null
  description?: string
  aliases?: string[]
  provenance?: ResourceProvenance
  mcpServer?: string | null
  toolName?: string | null
  toolArgs?: Record<string, unknown> | null
  externalRef?: string | null
}

/** Partial update to a resource (user-editable fields only). */
export type ResourcePatch = Partial<
  Pick<
    Resource,
    | 'title'
    | 'kind'
    | 'source'
    | 'service'
    | 'env'
    | 'tags'
    | 'url'
    | 'description'
    | 'aliases'
    | 'pinnedGroup'
    | 'mcpServer'
    | 'toolName'
    | 'toolArgs'
    | 'externalRef'
  >
>

/** The tiny, always-injected per-project brief. */
export interface ProjectCard {
  projectId: number
  purpose: string
  repos: string[]
  services: string[]
  activeGoal: string
  /** term -> definition. */
  glossary: Record<string, string>
  updatedAt: string
}

export type ProjectCardPatch = Partial<Pick<ProjectCard, 'purpose' | 'repos' | 'services' | 'activeGoal' | 'glossary'>>

/** A wired MCP server whose read-only tools the app-owned client may run. */
export interface McpServerConfig {
  id: string
  projectId: number
  label: string
  /** { command, args[], env{} } for the stdio transport. */
  config: McpStdioConfig
  createdAt: string
  updatedAt: string
}

export interface McpStdioConfig {
  command: string
  args: string[]
  env: Record<string, string>
}

export type McpServerInput = Pick<McpServerConfig, 'label'> & { config: McpStdioConfig }

/**
 * Redacted view of a wired MCP server for the RENDERER. Deliberately carries no
 * env VALUES — only the key names — so secrets never cross the IPC boundary. The
 * full config (with env values) stays main-only via getMcpServer(), used solely
 * by the resolver's app-owned MCP read.
 */
export interface McpServerSummary {
  id: string
  projectId: number
  label: string
  command: string
  args: string[]
  /** Names of the configured env vars; values are intentionally omitted. */
  envKeys: string[]
  createdAt: string
  updatedAt: string
}

/**
 * Explicit patch for an existing MCP server. Secrets flow ONE WAY: `envSet` adds
 * or replaces keys, `envDelete` removes keys, and any env key not named in either
 * is preserved server-side. This avoids a "leave blank to keep" guess and means
 * the renderer never has to hold or re-send a stored secret value.
 */
export interface McpServerPatch {
  label?: string
  command?: string
  args?: string[]
  envSet?: Record<string, string>
  envDelete?: string[]
}

/** A tool advertised by a wired MCP server (from listTools). */
export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: unknown
}

/**
 * Result of probing a server's tools — the honest "does it start, and what can
 * it do". A success means the server process started and answered a listTools
 * handshake; it does NOT prove a real read (or auth for one) will succeed.
 */
export type McpToolsResult = { ok: true; tools: McpToolInfo[] } | { ok: false; error: string }

/** Wires a resource to a configured server tool so a resolve can pull a live value. */
export interface McpConnectInput {
  serverId: string
  toolName: string
  toolArgs: Record<string, unknown>
}

/** A proposed typed record produced from a pasted/dropped URL, for one-tap accept. */
export interface CaptureProposal {
  title: string
  kind: ResourceKind
  source: string
  service: string
  env: string
  url: string | null
  externalRef: string | null
  tags: Record<string, string>
}

/** The verdict of a resolve. See the safety contract: the app owns every guarantee. */
export type ResolveVerdict =
  | 'confident'                      // cited source + app-owned live value
  | 'source_available_no_live_value' // cited source, no live read possible
  | 'clarify'                        // near-tie: one question / top candidates
  | 'none'                           // no source saved

export type ResolveFailureClass =
  | 'query_invalid'
  | 'no_data'
  | 'auth_missing'
  | 'connector_down'
  | 'timeout'
  | 'model_bad_output'
  | 'user_cancelled'

/** A citation to a resource, inspectable by the user. */
export interface ResolveCitation {
  resourceId: number
  title: string
  kind: ResourceKind
  source: string
  url: string | null
  /** True when this record last failed and is relevant to the current question. */
  suspect: boolean
}

/**
 * Which retrieval path produced a resolve's candidates. Keeps a degraded run
 * observable end-to-end: `semantic` = the semantic (embedding) retriever path
 * handled the query (it may short-circuit without invoking the model, e.g. an
 * empty corpus); `lexical-fallback` = the embedding model failed at runtime and
 * the resolver fell back to lexical; `lexical` = a lexical retriever was
 * configured (e.g. tests).
 */
export type RetrievalMode = 'semantic' | 'lexical-fallback' | 'lexical'

/**
 * The result of asking the resolver a question. `confident` and
 * `source_available_no_live_value` carry a single `citation`; `clarify` carries
 * its options in `candidates` (and leaves `citation` null); `none` carries
 * neither.
 */
export interface ResolveResult {
  verdict: ResolveVerdict
  /** Natural-language answer (e.g. "p99 240ms" or "no source saved for that"). */
  answer: string
  /** The cited source for confident / source_available_no_live_value verdicts. */
  citation: ResolveCitation | null
  /** App-owned live value pulled via the MCP client. Null unless verdict='confident'. */
  liveValue: string | null
  /** One clarifying question, when verdict='clarify'. */
  clarifyQuestion: string | null
  /** Top candidate citations, when verdict='clarify'. */
  candidates: ResolveCitation[]
  /** Set when the resolve failed; classifies bad-source vs bad-infra. */
  failureClass: ResolveFailureClass | null
  /** Which retrieval path produced the candidates (observability of degraded runs). */
  retrievalMode: RetrievalMode
}

/** A computed browse group of resources (by source / service / topic). */
export interface ResourceGroup {
  /** Stable key for React lists + pin/rename overrides. */
  key: string
  label: string
  resources: Resource[]
}

// ── Request-response channels ─────────────────────────────────────────────────

export type IpcChannels = {
  /** Health-check — returns 'pong'. Used in M1 to verify IPC is wired up. */
  'app:ping': {
    args: []
    result: string
  }

  /** Returns the current authentication status. */
  'auth:status': {
    args: []
    result: AuthStatus
  }

  /**
   * Validates a PAT, stores it via safeStorage, and returns the resulting
   * auth status. Throws if the token is invalid.
   */
  'auth:save-token': {
    args: [token: string]
    result: AuthStatus
  }

  /** Clears the stored token and resets auth state. */
  'auth:logout': {
    args: []
    result: void
  }

  /** Opens a URL in the user's default browser via shell.openExternal. */
  'app:open-external': {
    args: [url: string]
    result: void
  }

  // ── Projects ───────────────────────────────────────────────────────────────

  /** Returns all projects ordered by sort_order. */
  'projects:list': {
    args: []
    result: Project[]
  }

  /** Returns a single project with its todos and links. */
  'projects:get': {
    args: [id: number]
    result: ProjectDetail
  }

  /** Creates a new project with the given name. */
  'projects:create': {
    args: [name: string]
    result: Project
  }

  /** Updates fields on an existing project. */
  'projects:update': {
    args: [id: number, patch: ProjectPatch]
    result: Project
  }

  /** Deletes a project and all its todos and links. */
  'projects:delete': {
    args: [id: number]
    result: void
  }

  /**
   * Snoozes a project. mode='manual' keeps it snoozed indefinitely;
   * mode='date' wakes it at `until` (ISO 8601 string in UTC, e.g. from Date.toISOString());
   * mode='notification' wakes it when the next notification routes to this project.
   */
  'projects:snooze': {
    args: [id: number, mode: SnoozeMode, until?: string]
    result: Project
  }

  // ── Todos ──────────────────────────────────────────────────────────────────

  /** Creates a new todo for the given project. */
  'todos:create': {
    args: [projectId: number, text: string]
    result: ProjectTodo
  }

  /** Updates fields on an existing todo. */
  'todos:update': {
    args: [id: number, patch: ProjectTodoPatch]
    result: ProjectTodo
  }

  /** Deletes a todo. */
  'todos:delete': {
    args: [id: number]
    result: void
  }

  // ── Links ──────────────────────────────────────────────────────────────────

  /** Creates a new link for the given project. */
  'links:create': {
    args: [projectId: number, label: string, url: string]
    result: ProjectLink
  }

  /** Updates fields on an existing link. */
  'links:update': {
    args: [id: number, patch: ProjectLinkPatch]
    result: ProjectLink
  }

  /** Deletes a link. */
  'links:delete': {
    args: [id: number]
    result: void
  }

  // ── Notifications ──────────────────────────────────────────────────────────

  /** Returns all notification threads routed to a project, ordered by updated_at desc. */
  'notifications:list': {
    args: [projectId: number]
    result: NotificationThread[]
  }

  /** Returns all unmapped (inbox) notification threads, ordered by updated_at desc. */
  'notifications:inbox': {
    args: []
    result: NotificationThread[]
  }

  /** Returns unread notification counts per project for badge display. */
  'notifications:unread-counts': {
    args: []
    result: UnreadCount[]
  }

  /**
   * Assigns a thread to a project (or null to move back to inbox).
   * Returns a repo rule suggestion if one applies, otherwise null.
   */
  'notifications:assign': {
    args: [threadId: string, projectId: number | null]
    result: RepoRuleSuggestion | null
  }

  /** Marks a notification thread as read locally. No write-back to GitHub. */
  'notifications:mark-read': {
    args: [threadId: string]
    result: void
  }

  /** Marks multiple notification threads as read in one transaction. No write-back to GitHub. */
  'notifications:mark-read-many': {
    args: [threadIds: string[]]
    result: void
  }

  /**
   * Unsubscribes from a GitHub notification thread via the API,
   * then removes the thread from local storage.
   */
  'notifications:unsubscribe': {
    args: [threadId: string]
    result: void
  }

  /** Triggers an immediate notification sync. Resolves when sync completes. */
  'notifications:sync': {
    args: []
    result: void
  }

  /** Returns the ISO 8601 timestamp of the last completed notification sync, or null if never synced. */
  'notifications:last-sync-time': {
    args: []
    result: string | null
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  /** Returns the current background sync interval in minutes. */
  'settings:get-sync-interval': {
    args: []
    result: SyncIntervalMinutes
  }

  /** Persists the background sync interval and restarts the timer. */
  'settings:set-sync-interval': {
    args: [minutes: SyncIntervalMinutes]
    result: void
  }

  /** Returns the current maximum number of days to look back when syncing. */
  'settings:get-max-sync-days': {
    args: []
    result: MaxSyncDays
  }

  /** Persists the maximum sync look-back window in days. */
  'settings:set-max-sync-days': {
    args: [days: MaxSyncDays]
    result: void
  }

  // ── Repo rules ─────────────────────────────────────────────────────────────

  /** Returns all repo routing rules. */
  'repo-rules:list': {
    args: []
    result: RepoRule[]
  }

  /** Creates a repo-level routing rule. Overwrites any existing rule for that repo. */
  'repo-rules:create': {
    args: [repoOwner: string, repoName: string, projectId: number]
    result: RepoRule
  }

  /** Deletes a repo routing rule by id. */
  'repo-rules:delete': {
    args: [id: number]
    result: void
  }

  // ── Routing rules ──────────────────────────────────────────────────────────

  /** Returns all routing rules ordered by creation date. */
  'routing-rules:list': {
    args: []
    result: RoutingRule[]
  }

  /**
   * Creates a routing rule. At least one match_* condition must be set.
   * Throws if no conditions are provided.
   */
  'routing-rules:create': {
    args: [payload: CreateRoutingRulePayload]
    result: RoutingRule
  }

  /** Deletes a routing rule by id. */
  'routing-rules:delete': {
    args: [id: number]
    result: void
  }

  /**
   * Applies all routing rules to inbox threads (project_id IS NULL).
   * Rules are evaluated in creation order; first match wins.
   * Returns the number of threads that were routed.
   */
  'routing-rules:apply-to-inbox': {
    args: []
    result: { matched: number }
  }

  // ── Copilot sessions ───────────────────────────────────────────────────────

  /** Returns all Copilot sessions linked to a project, ordered by updated_at desc. */
  'copilot:sessions-for-project': {
    args: [projectId: number]
    result: CopilotSession[]
  }

  /**
   * Returns the highest-priority Copilot session status per project.
   * Keys are project IDs; only projects with active sessions are included.
   * Projects without active sessions are omitted (check via `key in result`).
   */
  'copilot:all-statuses': {
    args: []
    result: Record<number, CopilotSessionStatus>
  }

  /** Triggers an immediate Copilot session sync from GitHub. */
  'copilot:sync': {
    args: []
    result: void
  }

  /**
   * Launches a cloud `gh agent-task` off the render thread and returns the
   * optimistically-inserted session row (status 'in_progress'). On failure it
   * rejects with an `Error` whose `message` is `'GH_NOT_AUTHENTICATED'` or
   * starts with `'LAUNCH_FAILED: '` — renderer callers should read `err.message`.
   */
  'copilot:launch': {
    args: [payload: LaunchAgentTaskPayload]
    result: CopilotSession
  }

  /**
   * Returns unassigned Copilot sessions (project_id IS NULL) for the Agent Tasks
   * surface: active-first then newest, capped, including recently-completed ones.
   */
  'copilot:unassigned': {
    args: []
    result: CopilotSession[]
  }

  /** Count of active (non-completed) unassigned sessions, for the rail badge. */
  'copilot:unassigned-count': {
    args: []
    result: number
  }

  /**
   * Pins an unassigned session to a live project (sticky across syncs).
   * Throws if the project is missing or soft-deleted.
   */
  'copilot:assign': {
    args: [sessionId: string, projectId: number]
    result: void
  }

  /**
   * Candidate repos a project's agent task can target, resolved from the
   * project's repo rules and notification threads (distinct).
   */
  'copilot:launch-targets': {
    args: [projectId: number]
    result: LaunchTarget[]
  }

  // ── Focus: re-entry digest + drift ───────────────────────────────────────────

  /** Computes the blame-free "since you were here" digest for a project. */
  'digest:get': {
    args: [projectId: number]
    result: ReentryDigest
  }

  /** Advances a project's drift anchor (last_focused_at = now). Call on focus arrival. */
  'projects:mark-focused': {
    args: [projectId: number]
    result: void
  }

  /**
   * Marks the digest seen up to `asOf` (the ReentryDigest.asOf from digest:get),
   * advancing digest_seen_at. Clamped in main so it can't skip later work.
   */
  'digest:dismiss': {
    args: [projectId: number, asOf: string]
    result: void
  }

  /**
   * Suppresses a drifting project from resurfacing for a cooldown window
   * ("not now"). The per-project frequency cap.
   */
  'projects:resurface-dismiss': {
    args: [projectId: number]
    result: void
  }

  /** Restores a soft-deleted project (clears deleted_at). */
  'projects:restore': {
    args: [projectId: number]
    result: void
  }

  /** Restores a soft-deleted todo (clears deleted_at). */
  'todos:restore': {
    args: [id: number]
    result: void
  }

  // ── Resources / project brain (MVP C) ────────────────────────────────────────

  /** Lists a project's live resources. */
  'resources:list': {
    args: [projectId: number]
    result: Resource[]
  }

  /** Auto-grouped browse view for a project's resources. */
  'resources:groups': {
    args: [projectId: number]
    result: ResourceGroup[]
  }

  /** Proposes a typed record from a pasted/dropped URL (deterministic, no network). */
  'resources:capture-proposal': {
    args: [url: string]
    result: CaptureProposal
  }

  /** Creates a resource. */
  'resources:create': {
    args: [projectId: number, input: ResourceInput]
    result: Resource
  }

  /** Updates a resource (user-editable fields). */
  'resources:update': {
    args: [id: number, patch: ResourcePatch]
    result: Resource
  }

  /** Soft-deletes a resource (undoable). */
  'resources:delete': {
    args: [id: number]
    result: void
  }

  /** Restores a soft-deleted resource. */
  'resources:restore': {
    args: [id: number]
    result: void
  }

  /**
   * Resolves a fuzzy question against the project's brain. Runs off the render
   * thread: retrieve -> untrusted decide -> app-owned MCP read. Async; may take
   * a few seconds. Every non-`none` result carries an inspectable citation.
   */
  'resources:resolve': {
    args: [projectId: number, question: string]
    result: ResolveResult
  }

  /** Returns the project card (lazily created). */
  'resources:card-get': {
    args: [projectId: number]
    result: ProjectCard
  }

  /** Updates the project card. */
  'resources:card-upsert': {
    args: [projectId: number, patch: ProjectCardPatch]
    result: ProjectCard
  }

  /** Lists a project's live (non-deleted) wired MCP servers, REDACTED (no secret values). */
  'resources:mcp-list': {
    args: [projectId: number]
    result: McpServerSummary[]
  }

  /** Creates a wired MCP server (full config incl. secrets, entered once). Returns a redacted summary. */
  'resources:mcp-create': {
    args: [projectId: number, input: McpServerInput]
    result: McpServerSummary
  }

  /** Updates a wired MCP server via an explicit patch (secrets one-way). Returns a redacted summary. */
  'resources:mcp-update': {
    args: [projectId: number, id: string, patch: McpServerPatch]
    result: McpServerSummary
  }

  /** Soft-deletes a wired MCP server (undoable; resource links are preserved). */
  'resources:mcp-delete': {
    args: [projectId: number, id: string]
    result: void
  }

  /** Restores a soft-deleted MCP server. */
  'resources:mcp-restore': {
    args: [projectId: number, id: string]
    result: void
  }

  /** Probes a server: starts it and lists its tools (honest connection check; no tool run). */
  'resources:mcp-list-tools': {
    args: [projectId: number, id: string]
    result: McpToolsResult
  }

  /** Wires a resource to a configured server tool (validated in main). Returns the updated resource. */
  'resources:mcp-connect': {
    args: [resourceId: number, input: McpConnectInput]
    result: Resource
  }

  /** Clears a resource's live wiring. Returns the updated resource. */
  'resources:mcp-disconnect': {
    args: [resourceId: number]
    result: Resource
  }
}

export type IpcChannelName = keyof IpcChannels

// ── Window augmentation ──────────────────────────────────────────────────────
export interface PrefetchProgress {
  completed: number
  total: number
}

// The preload script exposes this API on window.electron via contextBridge.

export interface ElectronApi {
  ipc: {
    invoke<C extends IpcChannelName>(
      channel: C,
      ...args: IpcChannels[C]['args']
    ): Promise<IpcChannels[C]['result']>
  }
  openExternal: (url: string) => Promise<void>
  /** Registers a callback that fires whenever a notification sync completes. Returns an unsubscribe fn. */
  onNotificationsUpdated: (callback: () => void) => () => void
  /** Registers a callback for thread content prefetch progress. Returns an unsubscribe fn. */
  onPrefetchProgress: (callback: (progress: PrefetchProgress) => void) => () => void
  /** Registers a callback that fires whenever Copilot session state changes. Returns an unsubscribe fn. */
  onCopilotUpdated: (callback: () => void) => () => void
  /**
   * Registers a callback that fires when the main process changes project/drift
   * state: the periodic drift tick and the project mutations that emit
   * `projects:updated` (delete, restore, mark-focused, resurface-dismiss).
   * Returns an unsubscribe fn.
   */
  onProjectsUpdated: (callback: () => void) => () => void
  /** Registers a callback that fires whenever a project's resource registry changes. Returns an unsubscribe fn. */
  onResourcesUpdated: (callback: () => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronApi
  }
}
