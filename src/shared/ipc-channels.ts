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

export type CopilotSessionSource = 'github' | 'cli' | 'vscode-chat'

export interface CopilotSession {
  id: string                     // task UUID (github) or session UUID (cli/vscode-chat)
  projectId: number | null       // null = unlinked
  source: CopilotSessionSource
  status: CopilotSessionStatus
  title: string
  htmlUrl: string | null         // link to issue/PR on github.com
  startedAt: string              // ISO 8601
  updatedAt: string              // ISO 8601
  repoOwner: string | null
  repoName: string | null
  branch: string | null          // cli source: branch from workspace.yaml
  linkedPrUrl: string | null     // github source: PR opened by Copilot
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
   * Keys are project IDs; value is null when there are no active sessions.
   */
  'copilot:all-statuses': {
    args: []
    result: Record<number, CopilotSessionStatus>
  }

  /** Triggers an immediate Copilot session sync across all sources. */
  'copilot:sync': {
    args: []
    result: void
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
}

declare global {
  interface Window {
    electron: ElectronApi
  }
}
