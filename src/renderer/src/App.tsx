import { useState, useEffect, useCallback } from 'react'
import styles from './App.module.css'
import { Sidebar } from './components/Sidebar'
import { Dashboard } from './pages/Dashboard'
import { ProjectDetail } from './pages/ProjectDetail'
import { Inbox } from './pages/Inbox'
import { Settings } from './pages/Settings'
import { useProjects } from './hooks/useProjects'

type View = { page: 'dashboard' } | { page: 'project'; id: number } | { page: 'inbox' } | { page: 'settings' }

export function App() {
  const { projects, isLoading, createProject, refreshProjects } = useProjects()
  const [view, setView] = useState<View>({ page: 'dashboard' })
  const [inboxCount, setInboxCount] = useState(0)

  const loadInboxCount = useCallback(async () => {
    try {
      const threads = await window.electron.ipc.invoke('notifications:inbox')
      setInboxCount(threads.filter((t) => t.unread).length)
    } catch {
      // Notifications table may not exist yet during first boot before migration
    }
  }, [])

  useEffect(() => {
    void loadInboxCount()
    const unsub = window.electron.onNotificationsUpdated(() => { void loadInboxCount() })
    return unsub
  }, [loadInboxCount])

  if (isLoading) {
    return (
      <div className={styles.root}>
        <div className={styles.loadingRoot} />
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <Sidebar
        projects={projects}
        selectedId={view.page === 'project' ? view.id : null}
        onSelect={(id) => setView({ page: 'project', id })}
        inboxCount={inboxCount}
        onSelectInbox={() => setView({ page: 'inbox' })}
        inboxSelected={view.page === 'inbox'}
        onSelectSettings={() => setView({ page: 'settings' })}
        settingsSelected={view.page === 'settings'}
      />

      {view.page === 'dashboard' ? (
        <Dashboard
          projects={projects}
          onSelectProject={(id) => setView({ page: 'project', id })}
          onCreateProject={createProject}
        />
      ) : view.page === 'inbox' ? (
        <Inbox
          onAssigned={() => { void refreshProjects(); void loadInboxCount() }}
        />
      ) : view.page === 'settings' ? (
        <Settings />
      ) : (
        <ProjectDetail
          key={view.id}
          projectId={view.id}
          onBack={() => setView({ page: 'dashboard' })}
          onProjectChanged={refreshProjects}
        />
      )}
    </div>
  )
}
