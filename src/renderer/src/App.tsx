import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project } from '@shared/ipc-channels'
import styles from './App.module.css'
import { Titlebar } from './components/Titlebar'
import { ProjectRail } from './components/ProjectRail'
import { CommandPalette } from './components/CommandPalette'
import { UndoToast } from './components/UndoToast'
import { FocusPage } from './pages/FocusPage'
import { InboxView } from './pages/InboxView'
import { SettingsView } from './pages/SettingsView'
import { EmptyFocus } from './pages/EmptyFocus'
import { useProjects } from './hooks/useProjects'
import { useTheme } from './hooks/useTheme'
import { useFocus } from './hooks/useFocus'
import { useUndo } from './hooks/useUndo'
import { parseDbTimestampMs } from './timeSort'

type View = 'focus' | 'inbox' | 'settings'

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
      const threads = await window.electron.ipc.invoke('notifications:inbox')
      setInboxCount(threads.filter((t) => t.unread).length)
    } catch (err) {
      console.error('[App] Failed to load inbox count:', err)
    }
  }, [])

  useEffect(() => {
    void loadInboxCount()
    const unsub = window.electron.onNotificationsUpdated(() => { void loadInboxCount() })
    return unsub
  }, [loadInboxCount])

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
    const project = await createProject('Untitled project')
    selectProject(project.id)
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

  const snoozeProject = useCallback(async (id: number, mode: 'manual' | 'date') => {
    const until = mode === 'date' ? new Date(Date.now() + SNOOZE_DAYS * 86400000).toISOString() : undefined
    await window.electron.ipc.invoke('projects:snooze', id, mode, until)
    await refreshProjects()
  }, [refreshProjects])

  const unsnooze = useCallback(async (id: number) => {
    await updateProject(id, { status: 'active' })
    await refreshProjects()
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
    void window.electron.ipc.invoke('projects:resurface-dismiss', project.id).then(() => refreshProjects())
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

  const onDeleteCurrent = useCallback(() => {
    if (focusedId === null) return
    const current = projects.find((p) => p.id === focusedId)
    const removedId = focusedId
    void deleteProject(removedId)
    setFocusedId(nextFocusAfterRemoval(removedId))
    showUndo(current ? `Deleted ${current.name}` : 'Project deleted', () => {
      void window.electron.ipc.invoke('projects:restore', removedId).then(() => refreshProjects())
      setFocusedId(removedId)
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
        onToggleColorMode={() => theme.setColorMode(theme.resolvedColorMode === 'dark' ? 'light' : 'dark')}
        onOpenSettings={() => setView('settings')}
      />

      <div className={styles.body}>
        <ProjectRail
          projects={projects}
          focusedId={focusedId}
          inboxCount={inboxCount}
          collapsed={railCollapsed}
          onToggleCollapse={() => setRailCollapsed((v) => !v)}
          onSelect={selectProject}
          onSelectInbox={() => setView('inbox')}
          onNewProject={() => void handleNewProject()}
        />

        {view === 'inbox' ? (
          <InboxView onAssigned={() => { void refreshProjects(); void loadInboxCount() }} />
        ) : view === 'settings' ? (
          <SettingsView theme={theme} onClose={() => setView('focus')} />
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
        onNewProject={() => void handleNewProject()}
      />

      <UndoToast undo={undo} onAction={() => { undo?.onUndo(); clearUndo() }} />
    </div>
  )
}
