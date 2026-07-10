import { formatDistanceToNow } from 'date-fns'
import { Sparkles, GitPullRequest, PauseCircle, CheckCircle2, HelpCircle, ExternalLink, ArrowUpRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { parseDbTimestampMs } from '@shared/time'
import type { CopilotRowKind, CopilotRowStatus, CopilotSessionRow } from '../hooks/useCopilotSessions'
import { Icon } from './Icon'
import { fire, openExternal } from '../ipc'
import styles from './CopilotSessionsPanel.module.css'

interface StatusMeta {
  label: string
  icon: LucideIcon
  tone: string
}

/**
 * Source-aware status metadata. `waiting` deliberately reads differently per source:
 * a cloud task waiting means the agent needs you, but an app session `waiting` is an
 * idle/not-running session (matching how `TodoSessionChip` already labels it), so we
 * don't falsely tell the user a desktop session needs their attention.
 */
function statusMeta(kind: CopilotRowKind, status: CopilotRowStatus): StatusMeta {
  switch (status) {
    case 'in_progress':
      return { label: 'Working', icon: Sparkles, tone: styles.toneAgent }
    case 'pr_ready':
      return { label: 'PR ready', icon: GitPullRequest, tone: styles.toneAttention }
    case 'waiting':
      return kind === 'app'
        ? { label: 'Idle', icon: PauseCircle, tone: styles.toneQuiet }
        : { label: 'Needs you', icon: PauseCircle, tone: styles.toneAttention }
    case 'completed':
      return { label: 'Done', icon: CheckCircle2, tone: styles.toneQuiet }
    case 'unknown':
      return { label: 'Unknown', icon: HelpCircle, tone: styles.toneQuiet }
    default:
      return { label: String(status), icon: HelpCircle, tone: styles.toneQuiet }
  }
}

function sourceHint(row: CopilotSessionRow): string {
  if (row.kind === 'cloud') return 'Cloud'
  return row.origin === 'observed' ? 'Observed' : 'Launched'
}

function relativeTime(ts: string): string {
  const ms = parseDbTimestampMs(ts)
  return Number.isNaN(ms) ? '' : formatDistanceToNow(ms, { addSuffix: true })
}

function SessionRow({ row }: { row: CopilotSessionRow }): JSX.Element {
  const meta = statusMeta(row.kind, row.status)
  const started = relativeTime(row.startedAt)
  const { githubUrl, appSessionId } = row

  return (
    <div className={styles.row}>
      <span className={`${styles.status} ${meta.tone}`} title={meta.label}>
        <Icon icon={meta.icon} size={15} />
      </span>
      <div className={styles.body}>
        <div className={styles.title}>{row.title || 'Untitled session'}</div>
        <div className={styles.meta}>
          <span className={styles.hint}>{sourceHint(row)}</span>
          {' · '}
          {meta.label}
          {started ? ` · started ${started}` : ''}
        </div>
      </div>
      {githubUrl && (
        <button
          type="button"
          className={styles.rowAction}
          onClick={() => openExternal(githubUrl)}
          aria-label="Open on GitHub"
          title="Open on GitHub"
        >
          <Icon icon={ExternalLink} size={14} />
        </button>
      )}
      {appSessionId && (
        <button
          type="button"
          className={styles.rowAction}
          onClick={() =>
            fire(window.electron.ipc.invoke('copilot:open-app-session', appSessionId), 'copilot:open-app-session')
          }
          aria-label="Open in Copilot app"
          title="Open in Copilot app"
        >
          <Icon icon={ArrowUpRight} size={14} />
        </button>
      )}
    </div>
  )
}

export function CopilotSessionsPanel({
  rows,
  emptyIsAuthoritative,
}: {
  rows: CopilotSessionRow[]
  emptyIsAuthoritative: boolean
}): JSX.Element {
  if (rows.length === 0) {
    // Only a clean, both-sources-succeeded empty is a real "no sessions". A still-
    // loading or failed (non-authoritative) empty stays indeterminate so a transient
    // IPC failure never presents as "no sessions".
    return (
      <div className={styles.empty}>
        {emptyIsAuthoritative ? 'No Copilot sessions for this project yet.' : 'Loading…'}
      </div>
    )
  }
  return (
    <div className={styles.list}>
      {rows.map((row) => (
        <SessionRow key={row.key} row={row} />
      ))}
    </div>
  )
}
