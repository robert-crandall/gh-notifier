import { useCallback, useEffect, useRef, useState } from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import {
  RefreshCw,
  GitPullRequest,
  CircleDot,
  Tag,
  MessageSquare,
  GitCommit,
  CircleAlert,
  Bell,
  ExternalLink,
  Check,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { NotificationThread, NotificationType, Project, ProjectTodo, RepoRuleSuggestion } from '@shared/ipc-channels'
import type { LucideIcon } from 'lucide-react'
import { Icon } from '../components/Icon'
import { LinkifiedText } from '../components/LinkifiedText'
import { openExternal } from '../ipc'
import { isSafeExternalUrl } from '@shared/safe-url'
import styles from './InboxView.module.css'

interface InboxViewProps {
  onAssigned: () => void
  showUndo: (message: string, onUndo: () => void, actionLabel?: string) => void
}

const NOTIF_ICON: Record<NotificationType, LucideIcon> = {
  PullRequest: GitPullRequest,
  Issue: CircleDot,
  Release: Tag,
  Discussion: MessageSquare,
  Commit: GitCommit,
  CheckSuite: CircleAlert,
}

function relativeTime(iso: string): string {
  try {
    const parsed = parseISO(iso)
    return Number.isNaN(parsed.getTime()) ? '' : formatDistanceToNow(parsed, { addSuffix: true })
  } catch {
    return ''
  }
}

/** The link an agent todo's one-tap "open" affordance should point at, if any. */
function inboxTodoUrl(todo: ProjectTodo): string | null {
  const action = todo.suggestedAction
  if (action && (action.kind === 'pr_comment' || action.kind === 'open_url') && isSafeExternalUrl(action.url)) {
    return action.url
  }
  return isSafeExternalUrl(todo.sourceUrl) ? todo.sourceUrl : null
}

export function InboxView({ onAssigned, showUndo }: InboxViewProps): JSX.Element {
  const [threads, setThreads] = useState<NotificationThread[]>([])
  const [inboxTodos, setInboxTodos] = useState<ProjectTodo[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const [suggestion, setSuggestion] = useState<(RepoRuleSuggestion & { threadId: string }) | null>(null)
  const mountedRef = useRef(true)
  // Monotonic request id so a slower in-flight inbox-todo fetch can't overwrite a newer one
  // (e.g. a broad load() racing a todos:updated-triggered refresh).
  const todosReqRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadTodos = useCallback(async () => {
    const reqId = ++todosReqRef.current
    try {
      const todos = await window.electron.ipc.invoke('todos:inbox')
      if (mountedRef.current && reqId === todosReqRef.current) {
        setInboxTodos(todos.filter((t) => !t.done))
      }
    } catch (err) {
      console.error('[Inbox] Failed to load agent todos:', err)
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const [inbox, projectList, authStatus, syncTime] = await Promise.all([
        window.electron.ipc.invoke('notifications:inbox'),
        window.electron.ipc.invoke('projects:list'),
        window.electron.ipc.invoke('auth:status'),
        window.electron.ipc.invoke('notifications:last-sync-time'),
      ])
      if (!mountedRef.current) return
      setThreads(inbox)
      setProjects(projectList.filter((p) => p.status === 'active'))
      setIsAuthenticated(authStatus.authenticated)
      setLastSyncTime(syncTime)
    } catch (err) {
      console.error('[Inbox] Failed to load:', err)
      if (mountedRef.current) setSyncError('Could not load the inbox. Try syncing again.')
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
    // Inbox todos always flow through the single guarded loader.
    void loadTodos()
  }, [loadTodos])

  useEffect(() => {
    void load()
    const unsubNotif = window.electron.onNotificationsUpdated(() => { void load() })
    const unsubTodos = window.electron.onTodosUpdated(() => { void loadTodos() })
    return () => {
      unsubNotif()
      unsubTodos()
    }
  }, [load, loadTodos])

  const handleSync = useCallback(async () => {
    if (isSyncing) return
    setIsSyncing(true)
    setSyncError(null)
    try {
      await window.electron.ipc.invoke('notifications:sync')
      await load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (mountedRef.current) {
        setSyncError(msg.includes('NOT_AUTHENTICATED') ? 'Not connected to GitHub. Add a token in Settings.' : `Sync failed: ${msg}`)
      }
    } finally {
      if (mountedRef.current) setIsSyncing(false)
    }
  }, [isSyncing, load])

  const handleAssign = async (threadId: string, projectId: number): Promise<void> => {
    try {
      const result = await window.electron.ipc.invoke('notifications:assign', threadId, projectId)
      if (result) setSuggestion({ ...result, threadId })
      await load()
      onAssigned()
    } catch (err) {
      console.error('[Inbox] Assign failed:', err)
    }
  }

  const handleMarkRead = async (threadId: string): Promise<void> => {
    try {
      await window.electron.ipc.invoke('notifications:mark-read', threadId)
      setThreads((prev) => prev.filter((t) => t.id !== threadId))
    } catch (err) {
      console.error('[Inbox] Mark read failed:', err)
    }
  }

  const handleTodoDone = async (todo: ProjectTodo): Promise<void> => {
    try {
      await window.electron.ipc.invoke('todos:update', todo.id, { done: true })
      // Invalidate any in-flight inbox-todo fetch so a stale result can't re-add this row,
      // then optimistically drop it and refresh the rail badge.
      todosReqRef.current += 1
      setInboxTodos((prev) => prev.filter((t) => t.id !== todo.id))
      onAssigned()
      showUndo('Marked done', () => {
        void window.electron.ipc.invoke('todos:update', todo.id, { done: false }).then(() => {
          onAssigned()
          return loadTodos()
        })
      })
    } catch (err) {
      console.error('[Inbox] Mark todo done failed:', err)
    }
  }

  const handleTodoDismiss = async (todo: ProjectTodo): Promise<void> => {
    try {
      await window.electron.ipc.invoke('todos:delete', todo.id)
      todosReqRef.current += 1
      setInboxTodos((prev) => prev.filter((t) => t.id !== todo.id))
      onAssigned()
      showUndo('Todo dismissed', () => {
        void window.electron.ipc.invoke('todos:restore', todo.id).then(() => {
          onAssigned()
          return loadTodos()
        })
      })
    } catch (err) {
      console.error('[Inbox] Dismiss todo failed:', err)
    }
  }

  const acceptRule = async (): Promise<void> => {
    if (!suggestion) return
    try {
      await window.electron.ipc.invoke('repo-rules:create', suggestion.repoOwner, suggestion.repoName, suggestion.projectId)
    } catch (err) {
      console.error('[Inbox] Repo rule creation failed:', err)
    }
    setSuggestion(null)
  }

  return (
    <main className={styles.main}>
      <header className={styles.toolbar}>
        <span className={styles.title}>Inbox</span>
        <div className={styles.syncControls}>
          {lastSyncTime && <span className={styles.lastSync}>Synced {relativeTime(lastSyncTime)}</span>}
          <button type="button" className={styles.syncButton} onClick={() => void handleSync()} disabled={isSyncing}>
            <Icon icon={RefreshCw} size={14} className={isSyncing ? styles.spin : ''} />
            {isSyncing ? 'Syncing…' : 'Sync'}
          </button>
        </div>
      </header>

      {suggestion && (
        <div className={styles.suggestion}>
          <span>
            {suggestion.type === 'opt-in'
              ? `Always route ${suggestion.repoOwner}/${suggestion.repoName} to "${suggestion.projectName}"?`
              : `All ${suggestion.repoOwner}/${suggestion.repoName} threads go to "${suggestion.projectName}". Create a rule?`}
          </span>
          <div className={styles.suggestionActions}>
            <button type="button" className={styles.accept} onClick={() => void acceptRule()}>Create rule</button>
            <button type="button" className={styles.dismiss} onClick={() => setSuggestion(null)}>No thanks</button>
          </div>
        </div>
      )}

      <div className={styles.content}>
        {inboxTodos.length > 0 && (
          <>
            <div className={styles.sectionLabel}>
              <Icon icon={Sparkles} size={13} />
              From Copilot
            </div>
            {inboxTodos.map((t) => {
              const url = inboxTodoUrl(t)
              return (
                <div key={t.id} className={styles.row}>
                  <Icon icon={Sparkles} size={16} className={styles.rowIcon} />
                  <div className={styles.rowBody}>
                    <div className={styles.rowTitle}>{t.title ?? t.text}</div>
                    {t.body && <div className={styles.todoBody}><LinkifiedText text={t.body} /></div>}
                  </div>
                  {url && (
                    <button type="button" className={styles.rowAction} onClick={() => openExternal(url)} aria-label="Open link">
                      <Icon icon={ExternalLink} size={14} />
                    </button>
                  )}
                  <button type="button" className={styles.rowAction} onClick={() => void handleTodoDone(t)} aria-label="Mark done">
                    <Icon icon={Check} size={14} />
                  </button>
                  <button type="button" className={styles.rowAction} onClick={() => void handleTodoDismiss(t)} aria-label="Dismiss todo">
                    <Icon icon={Trash2} size={14} />
                  </button>
                </div>
              )
            })}
          </>
        )}

        {isLoading && <div className={styles.empty}>Loading…</div>}
        {!isLoading && syncError && <div className={styles.error}>{syncError}</div>}
        {!isLoading && isAuthenticated === false && (
          <div className={styles.empty}>Connect a GitHub token in Settings to fetch notifications.</div>
        )}
        {!isLoading && isAuthenticated && threads.length === 0 && inboxTodos.length === 0 && !syncError && (
          <div className={styles.empty}>Inbox is empty. Nothing needs routing.</div>
        )}

        {threads.length > 0 && inboxTodos.length > 0 && (
          <div className={styles.sectionLabel}>
            <Icon icon={Bell} size={13} />
            Notifications
          </div>
        )}

        {threads.map((t) => (
          <div key={t.id} className={styles.row}>
            <Icon icon={NOTIF_ICON[t.type] ?? Bell} size={16} className={styles.rowIcon} />
            <div className={styles.rowBody}>
              <div className={styles.rowTitle}>{t.title}</div>
              <div className={styles.rowMeta}>{t.repoOwner}/{t.repoName} · {relativeTime(t.updatedAt)}</div>
            </div>
            <select
              className={styles.assign}
              value=""
              onChange={(e) => e.target.value && void handleAssign(t.id, Number(e.target.value))}
            >
              <option value="">Assign…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {t.htmlUrl && (
              <button type="button" className={styles.rowAction} onClick={() => openExternal(t.htmlUrl as string)} aria-label="Open">
                <Icon icon={ExternalLink} size={14} />
              </button>
            )}
            <button type="button" className={styles.rowAction} onClick={() => void handleMarkRead(t.id)} aria-label="Mark read">
              <Icon icon={Check} size={14} />
            </button>
          </div>
        ))}
      </div>
    </main>
  )
}
