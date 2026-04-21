import type { Project } from '../../../shared/types'
import styles from './Dashboard.module.css'

interface DashboardProps {
  projects: Project[]
  onSelectProject: (id: number) => void
  onNewProject: () => void
}

export function Dashboard({ projects, onSelectProject, onNewProject }: DashboardProps): JSX.Element {
  const activeProjects = projects.filter((p) => p.status === 'active')
  const snoozedProjects = projects.filter((p) => p.status === 'snoozed')

  const focusProject = activeProjects[0] ?? null
  const remainingProjects = activeProjects.slice(1)

  return (
    <div className={styles.root}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>Projects</span>
        <button className={styles.newButton} onClick={onNewProject}>
          New project
        </button>
      </div>

      {/* Content */}
      <div className={styles.content}>
        {activeProjects.length === 0 ? (
          <div className={styles.empty}>
            <p>No active projects yet.</p>
            <button className={styles.newButton} onClick={onNewProject}>
              Create your first project
            </button>
          </div>
        ) : (
          <>
            {/* Focus Banner */}
            {focusProject && focusProject.nextAction && (
              <button
                className={styles.focusBanner}
                onClick={() => onSelectProject(focusProject.id)}
              >
                <div className={styles.focusLabel}>
                  <svg width="8" height="10" viewBox="0 0 8 10" fill="none" aria-hidden="true">
                    <path d="M0 0l8 5-8 5V0z" fill="rgba(255,255,255,0.5)" />
                  </svg>
                  FOCUS NOW · {focusProject.name.toUpperCase()}
                </div>
                <div className={styles.focusAction}>{focusProject.nextAction}</div>
              </button>
            )}

            {/* Remaining project rows */}
            {remainingProjects.map((project) => (
              <button
                key={project.id}
                className={styles.projectRow}
                onClick={() => onSelectProject(project.id)}
              >
                <div className={styles.projectInfo}>
                  <span className={styles.projectName}>{project.name}</span>
                  {project.nextAction && (
                    <span className={styles.nextAction}>{project.nextAction}</span>
                  )}
                </div>
                <svg
                  className={styles.chevron}
                  width="6"
                  height="10"
                  viewBox="0 0 6 10"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M1 1l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            ))}

            {/* Snoozed footer */}
            {snoozedProjects.length > 0 && (
              <div className={styles.snoozedFooter}>
                <span>💤 {snoozedProjects.length} snoozed project{snoozedProjects.length !== 1 ? 's' : ''}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
