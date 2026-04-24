import { useState } from 'react'
import type { NotificationThread, NotificationType, Project, SubjectState } from '@shared/ipc-channels'
import styles from './ThreadedNotificationList.module.css'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ThreadedNotificationListProps {
  threads: NotificationThread[]
  /** Provide projects to show the Assign button per thread. Omit for project-scoped views. */
  projects?: Project[]
  onMarkRead: (threadId: string) => Promise<void>
  onUnsubscribe: (threadId: string) => Promise<void>
  /** Called when a thread is assigned to a project. Requires `projects` to be set. */
  onAssign?: (threadId: string, projectId: number) => Promise<void>
  emptyMessage?: string
}

// ── Grouping helpers ─────────────────────────────────────────────────────────

type TypeGroup = Map<string, NotificationThread[]>
type RepoGroups = Map<string, TypeGroup>

function groupThreads(threads: NotificationThread[]): RepoGroups {
  const byRepo: RepoGroups = new Map()
  for (const t of threads) {
    const repoKey = `${t.repoOwner}/${t.repoName}`
    if (!byRepo.has(repoKey)) byRepo.set(repoKey, new Map())
    const byType = byRepo.get(repoKey)!
    const existing = byType.get(t.type) ?? []
    existing.push(t)
    byType.set(t.type, existing)
  }
  return byRepo
}

function typeLabel(type: string): string {
  switch (type) {
    case 'PullRequest': return 'Pull Requests'
    case 'Issue': return 'Issues'
    case 'Release': return 'Releases'
    case 'Discussion': return 'Discussions'
    case 'CheckSuite': return 'CI'
    case 'Commit': return 'Commits'
    default: return type
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function ThreadedNotificationList({
  threads,
  projects,
  onMarkRead,
  onUnsubscribe,
  onAssign,
  emptyMessage = 'No notifications.',
}: ThreadedNotificationListProps) {
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [collapsedRepos, setCollapsedRepos] = useState<Set<string>>(new Set())
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set())

  if (threads.length === 0) {
    return <div className={styles.empty}>{emptyMessage}</div>
  }

  const groups = groupThreads(threads)

  const toggleRepo = (repoKey: string) => {
    setCollapsedRepos((prev) => {
      const next = new Set(prev)
      next.has(repoKey) ? next.delete(repoKey) : next.add(repoKey)
      return next
    })
  }

  const toggleType = (typeKey: string) => {
    setCollapsedTypes((prev) => {
      const next = new Set(prev)
      next.has(typeKey) ? next.delete(typeKey) : next.add(typeKey)
      return next
    })
  }

  const markAllRead = async (threadList: NotificationThread[]) => {
    await Promise.allSettled(
      threadList.filter((t) => t.unread).map((t) => onMarkRead(t.id))
    )
  }

  return (
    <div className={styles.root}>
      {Array.from(groups.entries()).map(([repoKey, typeGroups]) => {
        const repoThreads = Array.from(typeGroups.values()).flat()
        const repoCollapsed = collapsedRepos.has(repoKey)
        const repoHasUnread = repoThreads.some((t) => t.unread)

        return (
        <div key={repoKey} className={styles.repoGroup}>
          <div className={styles.repoHeader}>
            <button
              className={styles.collapseBtn}
              onClick={() => toggleRepo(repoKey)}
              aria-label={repoCollapsed ? 'Expand' : 'Collapse'}
            >
              <ChevronIcon collapsed={repoCollapsed} />
            </button>
            <span className={styles.repoLabel}>{repoKey}</span>
            <div className={styles.repoDivider} />
            {repoHasUnread && (
              <button
                className={styles.markAllBtn}
                onClick={() => void markAllRead(repoThreads)}
                title="Mark all as read"
              >
                Mark all read
              </button>
            )}
          </div>

          {!repoCollapsed && Array.from(typeGroups.entries()).map(([type, typeThreads]) => {
            const typeKey = `${repoKey}:${type}`
            const typeCollapsed = collapsedTypes.has(typeKey)
            const typeHasUnread = typeThreads.some((t) => t.unread)

            return (
            <div key={type} className={styles.typeGroup}>
              <div className={styles.typeHeader}>
                <button
                  className={styles.collapseBtn}
                  onClick={() => toggleType(typeKey)}
                  aria-label={typeCollapsed ? 'Expand' : 'Collapse'}
                >
                  <ChevronIcon collapsed={typeCollapsed} />
                </button>
                <span className={styles.typeLabel}>{typeLabel(type)}</span>
                <span className={styles.typeCount}>{typeThreads.length}</span>
                {typeHasUnread && (
                  <button
                    className={styles.markAllBtn}
                    onClick={() => void markAllRead(typeThreads)}
                    title="Mark all as read"
                  >
                    Mark all read
                  </button>
                )}
              </div>

              {!typeCollapsed && typeThreads.map((thread) => (
                <div key={thread.id} className={styles.threadRow}>
                  <div className={styles.threadDot} data-unread={thread.unread} />

                  <div className={styles.threadBody}>
                    <div className={styles.threadTitle}>
                      {thread.htmlUrl ? (
                        <button
                          className={`${styles.threadName} ${styles.threadNameLink}`}
                          data-unread={thread.unread}
                          onClick={() => window.electron.openExternal(thread.htmlUrl!)}
                          title="Open in browser"
                        >
                          {thread.title}
                        </button>
                      ) : (
                        <span className={styles.threadName} data-unread={thread.unread}>
                          {thread.title}
                        </span>
                      )}
                      {thread.subjectState && thread.subjectState !== 'open' && (
                        <StateChip state={thread.subjectState} />
                      )}
                    </div>
                  </div>

                  <div className={styles.threadActions}>
                    <div className={styles.threadIconGroup}>
                      {thread.htmlUrl && (
                        <button
                          className={styles.iconBtn}
                          title="Open in GitHub"
                          aria-label="Open in GitHub"
                          onClick={() => window.electron.openExternal(thread.htmlUrl!)}
                        >
                          <ExternalLinkIcon />
                        </button>
                      )}
                      <button
                        className={styles.iconBtn}
                        title="Mark as read"
                        aria-label="Mark as read"
                        disabled={!thread.unread}
                        onClick={() => void onMarkRead(thread.id)}
                      >
                        <MarkReadIcon />
                      </button>
                      <button
                        className={styles.iconBtn}
                        title="Unsubscribe"
                        aria-label="Unsubscribe"
                        onClick={() => void onUnsubscribe(thread.id)}
                      >
                        <UnsubscribeIcon />
                      </button>
                    </div>

                    {projects && onAssign && (
                      assigningId === thread.id ? (
                        <select
                          className={styles.projectSelect}
                          autoFocus
                          defaultValue=""
                          onChange={(e) => {
                            const val = e.target.value
                            if (val) void onAssign(thread.id, parseInt(val, 10))
                            setAssigningId(null)
                          }}
                          onBlur={() => setAssigningId(null)}
                        >
                          <option value="" disabled>Assign to…</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      ) : (
                        <button
                          className={styles.assignBtn}
                          onClick={() => setAssigningId(thread.id)}
                        >
                          Assign
                        </button>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
            )
          })}
        </div>
        )
      })}
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StateChip({ state }: { state: SubjectState }) {
  const classes = [styles.stateChip]
  if (state === 'merged') classes.push(styles.stateMerged)
  else if (state === 'closed') classes.push(styles.stateClosed)
  return <span className={classes.join(' ')}>{state}</span>
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className={collapsed ? styles.chevronCollapsed : styles.chevronExpanded}
    >
      <path d="M2.5 3.5 5 6l2.5-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M5 2H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M8 1.5H11.5V5M11.5 1.5 5.5 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function MarkReadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M2 6.5l3.5 3.5 5.5-5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function UnsubscribeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M6.5 1v.5M5 11a1.5 1.5 0 0 0 3 0M3 9.5h7L9 8V5.5a2.5 2.5 0 0 0-5 0V8L3 9.5Z" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="2" y1="2" x2="11" y2="11" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  )
}

// TypeChip is exported for use if callers need it (e.g. in flat list fallbacks)
export function TypeChip({ type }: { type: NotificationType }) {
  const classes = [styles.typeChip]
  if (type === 'PullRequest') classes.push(styles.typePR)
  else if (type === 'Issue') classes.push(styles.typeIssue)
  else if (type === 'Release') classes.push(styles.typeRelease)
  else classes.push(styles.typeOther)

  const label =
    type === 'PullRequest' ? 'PR'
    : type === 'CheckSuite' ? 'CI'
    : type

  return <span className={classes.join(' ')}>{label}</span>
}
