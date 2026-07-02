import { useCallback, useEffect, useState } from 'react'
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
} from 'lucide-react'
import type { NotificationThread, NotificationType, Project, RepoRuleSuggestion } from '@shared/ipc-channels'
import type { LucideIcon } from 'lucide-react'
import { Icon } from '../components/Icon'
import styles from './InboxView.module.css'

interface InboxViewProps {
  onAssigned: () => void
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

export function InboxView({ onAssigned }: InboxViewProps): JSX.Element {
  const [threads, setThreads] = useState<NotificationThread[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const [suggestion, setSuggestion] = useState<(RepoRuleSuggestion & { threadId: string }) | null>(null)

  const load = useCallback(async () => {
    try {
      const [inbox, projectList, authStatus, syncTime] = await Promise.all([
        window.electron.ipc.invoke('notifications:inbox'),
        window.electron.ipc.invoke('projects:list'),
        window.electron.ipc.invoke('auth:status'),
        window.electron.ipc.invoke('notifications:last-sync-time'),
      ])
      setThreads(inbox)
      setProjects(projectList.filter((p) => p.status === 'active'))
      setIsAuthenticated(authStatus.authenticated)
      setLastSyncTime(syncTime)
    } catch (err) {
      console.error('[Inbox] Failed to load:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const unsub = window.electron.onNotificationsUpdated(() => { void load() })
    return unsub
  }, [load])

  const handleSync = useCallback(async () => {
    if (isSyncing) return
    setIsSyncing(true)
    setSyncError(null)
    try {
      await window.electron.ipc.invoke('notifications:sync')
      await load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setSyncError(msg.includes('NOT_AUTHENTICATED') ? 'Not connected to GitHub. Add a token in Settings.' : `Sync failed: ${msg}`)
    } finally {
      setIsSyncing(false)
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
          <button className={styles.syncButton} onClick={() => void handleSync()} disabled={isSyncing}>
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
            <button className={styles.accept} onClick={() => void acceptRule()}>Create rule</button>
            <button className={styles.dismiss} onClick={() => setSuggestion(null)}>No thanks</button>
          </div>
        </div>
      )}

      <div className={styles.content}>
        {isLoading && <div className={styles.empty}>Loading…</div>}
        {!isLoading && syncError && <div className={styles.error}>{syncError}</div>}
        {!isLoading && isAuthenticated === false && (
          <div className={styles.empty}>Connect a GitHub token in Settings to fetch notifications.</div>
        )}
        {!isLoading && isAuthenticated && threads.length === 0 && !syncError && (
          <div className={styles.empty}>Inbox is empty. Nothing needs routing.</div>
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
              <button className={styles.rowAction} onClick={() => void window.electron.openExternal(t.htmlUrl as string)} aria-label="Open">
                <Icon icon={ExternalLink} size={14} />
              </button>
            )}
            <button className={styles.rowAction} onClick={() => void handleMarkRead(t.id)} aria-label="Mark read">
              <Icon icon={Check} size={14} />
            </button>
          </div>
        ))}
      </div>
    </main>
  )
}
