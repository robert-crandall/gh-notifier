import { useState, useEffect, useCallback } from 'react'
import type { Project } from '../../shared/types'
import { Sidebar } from './components/Sidebar'
import { Dashboard } from './pages/Dashboard'
import { ProjectDetail } from './pages/ProjectDetail'
import { NewProjectModal } from './components/NewProjectModal'
import styles from './App.module.css'

export function App(): JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null)
  const [showNewProjectModal, setShowNewProjectModal] = useState(false)

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null

  const loadProjects = useCallback(async () => {
    const list = await window.electron.ipc.invoke('projects:list')
    setProjects(list)
  }, [])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  function handleNewProject(): void {
    setShowNewProjectModal(true)
  }

  async function handleCreateProject(name: string): Promise<void> {
    const project = await window.electron.ipc.invoke('projects:create', { name })
    setProjects((prev) => [...prev, project])
    setActiveProjectId(project.id)
    setShowNewProjectModal(false)
  }

  async function handleUpdateProject(
    id: number,
    changes: Partial<{ name: string; notes: string; nextAction: string; status: 'active' | 'snoozed' }>
  ): Promise<void> {
    const updated = await window.electron.ipc.invoke('projects:update', { id, changes })
    setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)))
  }

  return (
    <div className={styles.layout}>
      <Sidebar
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={setActiveProjectId}
        onSelectDashboard={() => setActiveProjectId(null)}
        onNewProject={handleNewProject}
      />
      <main className={styles.main}>
        {activeProject ? (
          <ProjectDetail
            key={activeProject.id}
            project={activeProject}
            onBack={() => setActiveProjectId(null)}
            onUpdate={handleUpdateProject}
          />
        ) : (
          <Dashboard
            projects={projects}
            onSelectProject={setActiveProjectId}
            onNewProject={handleNewProject}
          />
        )}
      </main>
      {showNewProjectModal && (
        <NewProjectModal
          onCancel={() => setShowNewProjectModal(false)}
          onCreate={handleCreateProject}
        />
      )}
    </div>
  )
}
