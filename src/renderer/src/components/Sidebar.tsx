import styles from './Sidebar.module.css'
import type { Project } from '@shared/ipc-channels'

interface Props {
  projects: Project[]
  selectedId: number | null
  onSelect: (id: number) => void
}

export function Sidebar({ projects, selectedId, onSelect }: Props) {
  const active = projects.filter((p) => p.status === 'active')
  const snoozed = projects.filter((p) => p.status === 'snoozed')

  return (
    <aside className={styles.sidebar}>
      {/* Traffic-light spacer — native controls sit here */}
      <div className={styles.trafficLights} />

      <nav className={styles.nav}>
        <span className={styles.sectionHeader}>PROJECTS</span>

        <ul className={styles.list}>
          {active.map((p) => (
            <li key={p.id}>
              <button
                className={`${styles.projectRow} ${selectedId === p.id ? styles.selected : ''}`}
                onClick={() => onSelect(p.id)}
              >
                <span className={styles.projectName}>{p.name}</span>
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
