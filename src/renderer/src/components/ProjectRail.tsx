import { useState } from 'react'
import { ChevronsLeft, ChevronsRight, Sparkles, Moon, Inbox, Plus, ChevronRight, ChevronDown } from 'lucide-react'
import type { Project } from '@shared/ipc-channels'
import { Icon } from './Icon'
import { railStatus, type RailStatus } from './railStatus'
import styles from './ProjectRail.module.css'

interface ProjectRailProps {
  projects: Project[]
  focusedId: number | null
  inboxCount: number
  collapsed: boolean
  onToggleCollapse: () => void
  onSelect: (id: number) => void
  onSelectInbox: () => void
  onNewProject: () => void
}

function StatusDot({ status }: { status: RailStatus }): JSX.Element {
  return (
    <span
      className={`${styles.dot} ${styles[`dot_${status.tone}`]} ${status.pulse ? styles.pulse : ''}`}
      aria-hidden
    />
  )
}

export function ProjectRail({
  projects,
  focusedId,
  inboxCount,
  collapsed,
  onToggleCollapse,
  onSelect,
  onSelectInbox,
  onNewProject,
}: ProjectRailProps): JSX.Element {
  const [parkedOpen, setParkedOpen] = useState(false)

  const active = projects.filter((p) => p.status === 'active')
  const parked = projects.filter((p) => p.status === 'snoozed')

  if (collapsed) {
    return (
      <aside className={`${styles.rail} ${styles.collapsed}`}>
        <button type="button" className={styles.collapseBtn} onClick={onToggleCollapse} aria-label="Expand sidebar">
          <Icon icon={ChevronsRight} size={16} />
        </button>
        <div className={styles.collapsedList}>
          {active.map((p) => {
            const status = railStatus(p, p.id === focusedId)
            return (
              <button type="button"
                key={p.id}
                className={styles.collapsedItem}
                title={p.name}
                aria-label={p.name}
                onClick={() => onSelect(p.id)}
              >
                <StatusDot status={status} />
              </button>
            )
          })}
        </div>
        <div className={styles.spacer} />
        <button type="button" className={styles.collapsedItem} title="Inbox" aria-label="Inbox" onClick={onSelectInbox}>
          <Icon icon={Inbox} size={16} />
        </button>
      </aside>
    )
  }

  return (
    <aside className={styles.rail}>
      <div className={styles.header}>
        <span className={styles.sectionLabel}>Projects</span>
        <button type="button" className={styles.collapseBtn} onClick={onToggleCollapse} aria-label="Collapse sidebar">
          <Icon icon={ChevronsLeft} size={15} />
        </button>
      </div>

      <div className={styles.list}>
        {active.length === 0 && <div className={styles.empty}>No active projects yet.</div>}
        {active.map((p) => {
          const status = railStatus(p, p.id === focusedId)
          const focused = p.id === focusedId
          return (
            <button type="button"
              key={p.id}
              className={`${styles.item} ${focused ? styles.itemFocused : ''}`}
              onClick={() => onSelect(p.id)}
            >
              <StatusDot status={status} />
              <span className={`${styles.itemName} ${status.tone === 'drifting' ? styles.dim : ''}`}>{p.name}</span>
              {status.tone === 'agent' && <Icon icon={Sparkles} size={13} className={styles.agentIcon} />}
              {status.label && <span className={`${styles.itemLabel} ${styles[`label_${status.tone}`]}`}>{status.label}</span>}
            </button>
          )
        })}
      </div>

      {parked.length > 0 && (
        <div className={styles.parked}>
          <button type="button" className={styles.parkedHeader} onClick={() => setParkedOpen((v) => !v)}>
            <Icon icon={Moon} size={13} />
            <span className={styles.parkedText}>{parked.length} snoozed</span>
            <Icon icon={parkedOpen ? ChevronDown : ChevronRight} size={14} />
          </button>
          {parkedOpen &&
            parked.map((p) => (
              <button type="button" key={p.id} className={styles.item} onClick={() => onSelect(p.id)}>
                <span className={`${styles.dot} ${styles.dot_quiet}`} aria-hidden />
                <span className={`${styles.itemName} ${styles.dim}`}>{p.name}</span>
              </button>
            ))}
        </div>
      )}

      <div className={styles.spacer} />

      <div className={styles.footer}>
        <button type="button" className={styles.item} onClick={onSelectInbox}>
          <Icon icon={Inbox} size={15} />
          <span className={styles.itemName}>Inbox</span>
          {inboxCount > 0 && <span className={styles.badge}>{inboxCount}</span>}
        </button>
        <button type="button" className={styles.item} onClick={onNewProject}>
          <Icon icon={Plus} size={15} />
          <span className={styles.itemName}>New project</span>
        </button>
      </div>
    </aside>
  )
}
