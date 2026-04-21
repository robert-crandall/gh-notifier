import type { Project } from '../../../shared/types'
import styles from './Sidebar.module.css'

interface SidebarProps {
  projects: Project[]
  activeProjectId: number | null
  onSelectProject: (id: number) => void
  onSelectDashboard: () => void
  onNewProject: () => void
}

export function Sidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onSelectDashboard,
  onNewProject
}: SidebarProps): JSX.Element {
  const activeProjects = projects.filter((p) => p.status === 'active')
  const snoozedProjects = projects.filter((p) => p.status === 'snoozed')

  return (
    <aside className={styles.sidebar}>
      {/* Traffic lights spacer — window chrome uses hiddenInset */}
      <div className={styles.trafficLights} />

      <nav className={styles.nav}>
        <button
          className={`${styles.dashboardLink} ${activeProjectId === null ? styles.active : ''}`}
          onClick={onSelectDashboard}
        >
          All Projects
        </button>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>PROJECTS</div>
          {activeProjects.map((project) => (
            <button
              key={project.id}
              className={`${styles.projectRow} ${activeProjectId === project.id ? styles.active : ''}`}
              onClick={() => onSelectProject(project.id)}
            >
              <span className={styles.projectName}>{project.name}</span>
            </button>
          ))}
          <button className={styles.newProjectRow} onClick={onNewProject}>
            + New project
          </button>
        </div>

        {snoozedProjects.length > 0 && (
          <div className={styles.snoozedSection}>
            <div className={styles.sectionHeader}>SNOOZED</div>
            {snoozedProjects.map((project) => (
              <button
                key={project.id}
                className={`${styles.projectRow} ${styles.snoozed} ${activeProjectId === project.id ? styles.active : ''}`}
                onClick={() => onSelectProject(project.id)}
              >
                <span className={styles.projectName}>{project.name}</span>
              </button>
            ))}
          </div>
        )}
      </nav>
    </aside>
  )
}
