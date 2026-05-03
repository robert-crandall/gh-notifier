import { formatDistanceToNow } from 'date-fns'
import styles from './CopilotTab.module.css'
import type { CopilotSession, CopilotSessionStatus } from '@shared/ipc-channels'

interface Props {
  sessions: CopilotSession[]
}

const STATUS_ORDER: CopilotSessionStatus[] = ['in_progress', 'waiting', 'pr_ready', 'completed']

const STATUS_LABELS: Record<CopilotSessionStatus, string> = {
  in_progress: 'In Progress',
  waiting: 'Waiting',
  pr_ready: 'PR Ready',
  completed: 'Completed',
}

const SOURCE_LABELS: Record<CopilotSession['source'], string> = {
  github: 'GitHub',
}

function StatusIcon({ status }: { status: CopilotSessionStatus }) {
  const cls = {
    in_progress: styles.statusIconInProgress,
    waiting: styles.statusIconWaiting,
    pr_ready: styles.statusIconPrReady,
    completed: styles.statusIconCompleted,
  }[status]

  return <span className={`${styles.statusIcon} ${cls}`} aria-hidden="true" />
}

function SessionRow({ session }: { session: CopilotSession }) {
  const relativeTime = (() => {
    try {
      return formatDistanceToNow(new Date(session.startedAt), { addSuffix: true })
    } catch {
      return ''
    }
  })()

  const openLink = (url: string) => {
    void window.electron.openExternal(url)
  }

  return (
    <div className={styles.sessionRow}>
      <StatusIcon status={session.status} />

      <div className={styles.sessionBody}>
        <span className={styles.sessionTitle} title={session.title}>
          {session.title || '(Untitled)'}
        </span>
        <div className={styles.sessionMeta}>
          <span className={styles.sourceBadge}>{SOURCE_LABELS[session.source]}</span>
          {session.branch && (
            <span className={styles.branch} title={session.branch}>{session.branch}</span>
          )}
          {relativeTime && (
            <span className={styles.timestamp}>{relativeTime}</span>
          )}
        </div>
      </div>

      {(session.htmlUrl ?? session.linkedPrUrl) && (
        <button
          className={styles.linkBtn}
          onClick={() => openLink((session.htmlUrl ?? session.linkedPrUrl)!)}
          title="Open in browser"
          aria-label="Open in browser"
        >
          {/* External link icon */}
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M5 2H2a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M8 1h4m0 0v4m0-4L6 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  )
}

export function CopilotTab({ sessions }: Props) {
  if (sessions.length === 0) {
    return (
      <div className={styles.tabRoot}>
        <p className={styles.empty}>No Copilot sessions found for this project.</p>
      </div>
    )
  }

  // Group by status in priority order
  const grouped = STATUS_ORDER.reduce<Record<CopilotSessionStatus, CopilotSession[]>>(
    (acc, status) => {
      acc[status] = sessions.filter((s) => s.status === status)
      return acc
    },
    { in_progress: [], waiting: [], pr_ready: [], completed: [] }
  )

  return (
    <div className={styles.tabRoot}>
      {STATUS_ORDER.filter((s) => grouped[s].length > 0).map((status) => (
        <div key={status} className={styles.group}>
          <span className={styles.groupLabel}>{STATUS_LABELS[status]}</span>
          {grouped[status].map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </div>
      ))}
    </div>
  )
}
