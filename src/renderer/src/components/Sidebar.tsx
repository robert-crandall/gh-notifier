import styles from './Sidebar.module.css'
import type { Project } from '@shared/ipc-channels'

interface Props {
  projects: Project[]
  selectedId: number | null
  onSelect: (id: number) => void
  inboxCount: number
  onSelectInbox: () => void
  inboxSelected: boolean
}

export function Sidebar({ projects, selectedId, onSelect, inboxCount, onSelectInbox, inboxSelected }: Props) {
  const active = projects.filter((p) => p.status === 'active')
  const snoozed = projects.filter((p) => p.status === 'snoozed')

  return (
    <aside className={styles.sidebar}>
      {/* Traffic-light spacer — native controls sit here */}
      <div className={styles.trafficLights} />

      <nav className={styles.nav}>
        {/* Inbox row */}
        <button
          className={`${styles.inboxRow} ${inboxSelected ? styles.selected : ''}`}
          onClick={onSelectInbox}
        >
          {/* Inbox icon: tray shape */}
          <svg className={styles.inboxIcon} width="14" height="13" viewBox="0 0 14 13" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
            <path d="M1 6h3l1.5 2h3L10 6h3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none" />
          </svg>
          <span className={styles.inboxLabel}>Inbox</span>
          {inboxCount > 0 && (
            <span className={styles.badge}>{inboxCount}</span>
          )}
        </button>

        <div className={styles.divider} />

        <span className={styles.sectionHeader}>PROJECTS</span>

        <ul className={styles.list}>
          {active.map((p) => (
            <li key={p.id}>
              <button
                className={`${styles.projectRow} ${selectedId === p.id ? styles.selected : ''}`}
                onClick={() => onSelect(p.id)}
              >
                <span className={styles.projectName}>{p.name}</span>
                {p.unreadCount > 0 && (
                  <span className={styles.badge}>{p.unreadCount}</span>
                )}
              </button>
            </li>
          ))}

          {active.length === 0 && (
            <li className={styles.empty}>No projects yet</li>
          )}
        </ul>

        {snoozed.length > 0 && (
          <div className={styles.snoozedSection}>
            <span className={styles.sectionHeader}>SNOOZED</span>
            <ul className={styles.list}>
              {snoozed.map((p) => (
                <li key={p.id}>
                  <button
                    className={`${styles.projectRow} ${styles.snoozed} ${selectedId === p.id ? styles.selected : ''}`}
                    onClick={() => onSelect(p.id)}
                  >
                    <span className={styles.projectName}>{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>
    </aside>
  )
}
