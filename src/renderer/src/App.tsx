import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project, SnoozeMode } from '@shared/ipc-channels'
import styles from './App.module.css'
import { Titlebar } from './components/Titlebar'
import { ProjectRail } from './components/ProjectRail'
import { CommandPalette } from './components/CommandPalette'
import { UndoToast } from './components/UndoToast'
import { FocusPage } from './pages/FocusPage'
import { InboxView } from './pages/InboxView'
import { SettingsView } from './pages/SettingsView'
import { RulesView } from './pages/RulesView'
import { AgentTasksView } from './pages/AgentTasksView'
import { EmptyFocus } from './pages/EmptyFocus'
import { useProjects } from './hooks/useProjects'
import { useTheme } from './hooks/useTheme'
import { useFocus } from './hooks/useFocus'
import { useUndo } from './hooks/useUndo'
import { parseDbTimestampMs } from '@shared/time'

type View = 'focus' | 'inbox' | 'settings' | 'agent-tasks' | 'rules'

const SNOOZE_DAYS = 7

export function App(): JSX.Element {
  const { projects, isLoading, createProject, updateProject, deleteProject, refreshProjects } = useProjects()
  const theme = useTheme()
  const { focusedId, setFocusedId } = useFocus()
  const { undo, showUndo, clearUndo } = useUndo()
  const [view, setView] = useState<View>('focus')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [inboxCount, setInboxCount] = useState(0)
  const [agentTaskCount, setAgentTaskCount] = useState(0)

  // Keep focus on a valid project; fall back to the first active one.
  useEffect(() => {
    if (isLoading) return
    const stillExists = focusedId !== null && projects.some((p) => p.id === focusedId)
    if (!stillExists) {
      const firstActive = projects.find((p) => p.status === 'active')
      setFocusedId(firstActive?.id ?? null)
    }
  }, [isLoading, projects, focusedId, setFocusedId])

  const loadInboxCount = useCallback(async () => {
    try {
      const [threads, inboxTodos] = await Promise.all([
        window.electron.ipc.invoke('notifications:inbox'),
        window.electron.ipc.invoke('todos:inbox'),
      ])
      setInboxCount(threads.filter((t) => t.unread).length + inboxTodos.filter((t) => !t.done).length)
    } catch (err) {
      console.error('[App] Failed to load inbox count:', err)
    }
  }, [])

  useEffect(() => {
    void loadInboxCount()
    const unsubNotif = window.electron.onNotificationsUpdated(() => { void loadInboxCount() })
    const unsubTodos = window.electron.onTodosUpdated(() => { void loadInboxCount() })
    return () => {
      unsubNotif()
      unsubTodos()
    }
  }, [loadInboxCount])

  const loadAgentTaskCount = useCallback(async () => {
    try {
      const count = await window.electron.ipc.invoke('copilot:unassigned-count')
      setAgentTaskCount(count)
    } catch (err) {
      console.error('[App] Failed to load unassigned agent task count:', err)
    }
  }, [])

  useEffect(() => {
    void loadAgentTaskCount()
    const unsub = window.electron.onCopilotUpdated(() => { void loadAgentTaskCount() })
    return unsub
  }, [loadAgentTaskCount])

  // ⌘K opens the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const selectProject = useCallback((id: number) => {
    setFocusedId(id)
    setView('focus')
    setPaletteOpen(false)
  }, [setFocusedId])

  const handleNewProject = useCallback(async () => {
    setPaletteOpen(false)
    try {
      const project = await createProject('Untitled project')
      selectProject(project.id)
    } catch (err) {
      console.error('[App] Create project failed:', err)
    }
  }, [createProject, selectProject])

  // Drifting projects to resurface (excludes the focused one), stalest first, top 3.
  const drifting = useMemo<Project[]>(() => {
    return projects
      .filter((p) => p.driftState === 'drifting' && p.id !== focusedId)
      .sort((a, b) => {
        const aMs = a.lastFocusedAt ? parseDbTimestampMs(a.lastFocusedAt) : parseDbTimestampMs(a.createdAt)
        const bMs = b.lastFocusedAt ? parseDbTimestampMs(b.lastFocusedAt) : parseDbTimestampMs(b.createdAt)
        return aMs - bMs
      })
  }, [projects, focusedId])

  const snoozeProject = useCallback(async (id: number, mode: SnoozeMode) => {
    try {
      const until = mode === 'date' ? new Date(Date.now() + SNOOZE_DAYS * 86400000).toISOString() : undefined
      await window.electron.ipc.invoke('projects:snooze', id, mode, until)
      await refreshProjects()
    } catch (err) {
      console.error('[App] Snooze failed:', err)
    }
  }, [refreshProjects])

  const unsnooze = useCallback(async (id: number) => {
    try {
      await updateProject(id, { status: 'active' })
      await refreshProjects()
    } catch (err) {
      console.error('[App] Unsnooze failed:', err)
    }
  }, [updateProject, refreshProjects])

  const onPark = useCallback((project: Project) => {
    void snoozeProject(project.id, 'manual')
    showUndo(`Parked ${project.name}`, () => void unsnooze(project.id))
  }, [snoozeProject, unsnooze, showUndo])

  const onSnooze = useCallback((project: Project) => {
    void snoozeProject(project.id, 'date')
    showUndo(`Snoozed ${project.name}`, () => void unsnooze(project.id))
  }, [snoozeProject, unsnooze, showUndo])

  const onNotNow = useCallback((project: Project) => {
    void (async () => {
      try {
        await window.electron.ipc.invoke('projects:resurface-dismiss', project.id)
        await refreshProjects()
      } catch (err) {
        console.error('[App] Resurface-dismiss failed:', err)
      }
    })()
  }, [refreshProjects])

  const nextFocusAfterRemoval = useCallback((removedId: number): number | null => {
    const remaining = projects.filter((p) => p.status === 'active' && p.id !== removedId)
    return remaining[0]?.id ?? null
  }, [projects])

  const onSnoozeCurrent = useCallback(() => {
    if (focusedId === null) return
    const current = projects.find((p) => p.id === focusedId)
    void snoozeProject(focusedId, 'manual')
    setFocusedId(nextFocusAfterRemoval(focusedId))
    if (current) showUndo(`Parked ${current.name}`, () => { void unsnooze(current.id); setFocusedId(current.id) })
  }, [focusedId, projects, snoozeProject, nextFocusAfterRemoval, setFocusedId, showUndo, unsnooze])

  // Notification-triggered snooze: the project drops off the rail and wakes on its own
  // when the next notification routes/assigns to it. No date, no nag.
  const onSnoozeCurrentUntilNotification = useCallback(() => {
    if (focusedId === null) return
    const current = projects.find((p) => p.id === focusedId)
    void snoozeProject(focusedId, 'notification')
    setFocusedId(nextFocusAfterRemoval(focusedId))
    if (current) {
      showUndo(`Snoozed ${current.name} until its next notification`, () => {
        void unsnooze(current.id)
        setFocusedId(current.id)
      })
    }
  }, [focusedId, projects, snoozeProject, nextFocusAfterRemoval, setFocusedId, showUndo, unsnooze])

  const onDeleteCurrent = useCallback(() => {
    if (focusedId === null) return
    const current = projects.find((p) => p.id === focusedId)
    const removedId = focusedId
    void deleteProject(removedId).catch((err: unknown) => console.error('[App] Delete failed:', err))
    setFocusedId(nextFocusAfterRemoval(removedId))
    showUndo(current ? `Deleted ${current.name}` : 'Project deleted', () => {
      // Restore and refresh before refocusing so the "focused must exist" guard
      // doesn't bounce focus away before the project is back in the list.
      void (async () => {
        try {
          await window.electron.ipc.invoke('projects:restore', removedId)
          await refreshProjects()
          setFocusedId(removedId)
        } catch (err) {
          console.error('[App] Restore failed:', err)
        }
      })()
    })
  }, [focusedId, projects, deleteProject, nextFocusAfterRemoval, setFocusedId, showUndo, refreshProjects])

  if (isLoading) {
    return <div className={styles.root} />
  }

  return (
    <div className={styles.root}>
      <Titlebar
        onOpenPalette={() => setPaletteOpen(true)}
        colorMode={theme.resolvedColorMode}
        onToggleColorMode={() => theme.setColorMode(theme.resolvedColorMode === 'light' ? 'dark' : 'light')}
        onOpenSettings={() => setView('settings')}
      />

      <div className={styles.body}>
        <ProjectRail
          projects={projects}
          focusedId={focusedId}
          inboxCount={inboxCount}
          agentTaskCount={agentTaskCount}
          collapsed={railCollapsed}
          onToggleCollapse={() => setRailCollapsed((v) => !v)}
          onSelect={selectProject}
          onSelectInbox={() => setView('inbox')}
          onSelectAgentTasks={() => setView('agent-tasks')}
          onNewProject={() => void handleNewProject()}
        />

        {view === 'inbox' ? (
          <InboxView onAssigned={() => { void refreshProjects(); void loadInboxCount() }} showUndo={showUndo} />
        ) : view === 'agent-tasks' ? (
          <AgentTasksView />
        ) : view === 'settings' ? (
          <SettingsView theme={theme} onClose={() => setView('focus')} onOpenRules={() => setView('rules')} />
        ) : view === 'rules' ? (
          <RulesView
            onClose={() => setView('settings')}
            onRulesChanged={() => { void refreshProjects(); void loadInboxCount() }}
          />
        ) : focusedId === null ? (
          <EmptyFocus onNewProject={() => void handleNewProject()} />
        ) : (
          <FocusPage
            key={focusedId}
            projectId={focusedId}
            onProjectChanged={refreshProjects}
            showUndo={showUndo}
            drifting={drifting}
            onSelectProject={selectProject}
            onPark={onPark}
            onSnooze={onSnooze}
            onNotNow={onNotNow}
            onSnoozeCurrent={onSnoozeCurrent}
            onSnoozeCurrentUntilNotification={onSnoozeCurrentUntilNotification}
            onDeleteCurrent={onDeleteCurrent}
          />
        )}
      </div>

      <CommandPalette
        open={paletteOpen}
        projects={projects}
        onClose={() => setPaletteOpen(false)}
        onSelectProject={selectProject}
        onOpenInbox={() => { setView('inbox'); setPaletteOpen(false) }}
        onOpenSettings={() => { setView('settings'); setPaletteOpen(false) }}
        onOpenRules={() => { setView('rules'); setPaletteOpen(false) }}
        onNewProject={() => void handleNewProject()}
      />

      <UndoToast undo={undo} onAction={() => { undo?.onUndo(); clearUndo() }} />
    </div>
  )
}
