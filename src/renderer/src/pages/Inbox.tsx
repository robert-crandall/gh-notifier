import { useState, useEffect, useCallback } from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import styles from './Inbox.module.css'
import { ThreadedNotificationList } from '../components/ThreadedNotificationList'
import type { NotificationThread, Project, RepoRuleSuggestion } from '@shared/ipc-channels'

interface Props {
  onAssigned: () => void
}

export function Inbox({ onAssigned }: Props) {
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

  const handleSync = useCallback(async () => {
    if (isSyncing) return
    setIsSyncing(true)
    setSyncError(null)
    try {
      await window.electron.ipc.invoke('notifications:sync')
      await load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('NOT_AUTHENTICATED')) {
        setSyncError('Not connected to GitHub. Add a token in Settings.')
      } else {
        setSyncError(`Sync failed: ${msg}`)
      }
    } finally {
      setIsSyncing(false)
    }
  }, [isSyncing, load])

  useEffect(() => {
    void load()
    const unsub = window.electron.onNotificationsUpdated(() => { void load() })
    return unsub
  }, [load])

  const handleAssign = async (threadId: string, projectId: number) => {
    try {
      const result = await window.electron.ipc.invoke('notifications:assign', threadId, projectId)
      if (result) {
        setSuggestion({ ...result, threadId })
      }
      await load()
      onAssigned()
    } catch (err) {
      console.error('[Inbox] Assign failed:', err)
    }
  }

  const handleAcceptRepoRule = async () => {
    if (!suggestion) return
    try {
      await window.electron.ipc.invoke(
        'repo-rules:create',
        suggestion.repoOwner,
        suggestion.repoName,
        suggestion.projectId
      )
    } catch (err) {
      console.error('[Inbox] Repo rule creation failed:', err)
    }
    setSuggestion(null)
  }

  const handleDismissRepoRule = () => {
    setSuggestion(null)
  }

  const handleMarkRead = async (threadId: string) => {
    try {
      await window.electron.ipc.invoke('notifications:mark-read', threadId)
      setThreads((prev) => prev.filter((t) => t.id !== threadId))
    } catch (err) {
      console.error('[Inbox] Mark read failed:', err)
    }
  }

  const handleMarkReadMany = async (threadIds: string[]) => {
    try {
      await window.electron.ipc.invoke('notifications:mark-read-many', threadIds)
      setThreads((prev) => prev.filter((t) => !threadIds.includes(t.id)))
    } catch (err) {
      console.error('[Inbox] Mark read many failed:', err)
    }
  }

  const handleUnsubscribe = async (threadId: string) => {
    try {
      await window.electron.ipc.invoke('notifications:unsubscribe', threadId)
      await load()
      onAssigned()
    } catch (err) {
      console.error('[Inbox] Unsubscribe failed:', err)
    }
  }

  return (
    <div className={styles.main}>
      <header className={styles.toolbar}>
        <span className={styles.toolbarTitle}>Inbox</span>
        <div className={styles.syncControls}>
          {lastSyncTime && (
            <span className={styles.lastSyncTime}>
              {(() => {
                try {
                  const parsed = parseISO(lastSyncTime)
                  if (!isNaN(parsed.getTime())) {
                    return formatDistanceToNow(parsed, { addSuffix: true })
                  }
                } catch {
                  // Fall through to fallback
                }
                return 'recently'
              })()}
            </span>
          )}
          <button
            className={styles.syncButton}
            onClick={() => void handleSync()}
            disabled={isSyncing}
            aria-label="Sync notifications"
          >
            {isSyncing ? 'Syncing…' : 'Sync'}
          </button>
        </div>
      </header>

      {/* Repo rule suggestion banner */}
      {suggestion && (
        <div className={styles.suggestionBanner}>
          <p className={styles.suggestionText}>
            {suggestion.type === 'opt-in'
              ? `Always route notifications from ${suggestion.repoOwner}/${suggestion.repoName} to "${suggestion.projectName}"?`
              : `All notifications from ${suggestion.repoOwner}/${suggestion.repoName} are going to "${suggestion.projectName}". Create a rule?`}
          </p>
          <div className={styles.suggestionActions}>
            <button className={styles.suggestionAccept} onClick={handleAcceptRepoRule}>
              {suggestion.type === 'opt-out' ? 'Yes, create rule' : 'Yes, always route here'}
            </button>
            <button className={styles.suggestionDismiss} onClick={handleDismissRepoRule}>
              No thanks
            </button>
          </div>
        </div>
      )}

      <div className={styles.content}>
        {isLoading && <div className={styles.empty}>Loading…</div>}

        {!isLoading && syncError && (
          <div className={styles.errorBanner}>{syncError}</div>
        )}

        {!isLoading && !syncError && isAuthenticated === false && threads.length === 0 && (
          <div className={styles.empty}>
            <p>Connect a GitHub account to fetch notifications.</p>
          </div>
        )}

        {!isLoading && isAuthenticated && threads.length === 0 && (
          <div className={styles.empty}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect x="3" y="4" width="26" height="20" rx="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M3 16h7l3 4h6l3-4h7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
            </svg>
            <p>Inbox is empty</p>
          </div>
        )}

        {!isLoading && threads.length > 0 && (
          <ThreadedNotificationList
            threads={threads}
            projects={projects}
            onMarkRead={handleMarkRead}
            onMarkReadMany={handleMarkReadMany}
            onUnsubscribe={handleUnsubscribe}
            onAssign={handleAssign}
          />
        )}
      </div>
    </div>
  )
}
