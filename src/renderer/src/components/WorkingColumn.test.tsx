// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { CopilotSession, CopilotAppSession, ProjectDetail } from '@shared/ipc-channels'
import { WorkingColumn } from './WorkingColumn'

const invoke = vi.fn()
const openExternal = vi.fn(() => Promise.resolve())
let copilotCallback: (() => void) | null = null
const onCopilotUpdated = vi.fn((cb: () => void) => {
  copilotCallback = cb
  return () => {}
})
const onNotificationsUpdated = vi.fn(() => () => {})

let cloudSessions: CopilotSession[] = []
let appSessions: CopilotAppSession[] = []

function setSessions(cloud: CopilotSession[], app: CopilotAppSession[]): void {
  cloudSessions = cloud
  appSessions = app
}

beforeEach(() => {
  invoke.mockReset()
  openExternal.mockClear()
  onCopilotUpdated.mockClear()
  onNotificationsUpdated.mockClear()
  copilotCallback = null
  cloudSessions = []
  appSessions = []
  invoke.mockImplementation((channel: string) => {
    if (channel === 'copilot:sessions-for-project') return Promise.resolve(cloudSessions)
    if (channel === 'copilot:project-app-sessions') return Promise.resolve(appSessions)
    return Promise.resolve(undefined)
  })
  ;(globalThis as unknown as { window: Window }).window.electron = {
    ipc: { invoke },
    openExternal,
    onCopilotUpdated,
    onNotificationsUpdated,
  } as unknown as Window['electron']
})

function cloud(overrides: Partial<CopilotSession>): CopilotSession {
  return {
    id: 'c', projectId: 1, source: 'github', status: 'in_progress', title: 'Cloud task',
    htmlUrl: null, startedAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z',
    repoOwner: 'o', repoName: 'r', branch: null, linkedPrUrl: null, pinnedProjectId: null,
    ...overrides,
  }
}

function app(overrides: Partial<CopilotAppSession>): CopilotAppSession {
  return {
    id: 'a', projectId: 1, cwd: '/tmp/repo', title: 'App session', status: 'in_progress',
    repoOwner: 'o', repoName: 'r', origin: 'launched', pinnedProjectId: null,
    createdAt: '2026-07-01 00:00:00', updatedAt: '2026-07-01 00:00:00',
    ...overrides,
  }
}

function makeDetail(): ProjectDetail {
  return {
    id: 1, name: 'Alpha', notes: '', nextAction: '', status: 'active', sortOrder: 0,
    createdAt: '', updatedAt: '', unreadCount: 0, activeTodoCount: 0, snoozeMode: null,
    snoozeUntil: null, copilotStatus: null, lastFocusedAt: null, driftState: 'active',
    todos: [], links: [],
  }
}

function renderColumn(): void {
  render(
    <WorkingColumn
      detail={makeDetail()}
      onCreateTodo={vi.fn()}
      onToggleTodo={vi.fn()}
      onDeleteTodo={vi.fn()}
      onSaveNotes={vi.fn()}
      onDelegate={vi.fn()}
      appSessionsByTodo={new Map()}
      showUndo={vi.fn()}
    />
  )
}

describe('WorkingColumn — Copilot tab', () => {
  it('hides the Copilot tab when the project has no sessions', async () => {
    setSessions([], [])
    renderColumn()
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('copilot:project-app-sessions', 1))
    expect(screen.queryByRole('button', { name: 'Copilot' })).toBeNull()
  })

  it('shows the tab and lists merged cloud + app sessions with source-aware status labels', async () => {
    setSessions(
      [cloud({ id: 'c1', title: 'Cloud task', status: 'in_progress', updatedAt: '2026-07-02T12:00:00Z' })],
      [app({ id: 'a1', title: 'App session', status: 'waiting', origin: 'observed', updatedAt: '2026-07-02 09:00:00' })]
    )
    renderColumn()

    const tab = await screen.findByRole('button', { name: 'Copilot' })
    fireEvent.click(tab)

    expect(await screen.findByText('Cloud task')).toBeTruthy()
    expect(screen.getByText('App session')).toBeTruthy()
    // Cloud in_progress reads "Working"; app `waiting` reads "Idle" (not "Needs you").
    // The status icon carries the label as its title, so query that (the meta line
    // concatenates the label with the source hint + "started …").
    expect(screen.getByTitle('Working')).toBeTruthy()
    expect(screen.getByTitle('Idle')).toBeTruthy()
    expect(screen.getByText('Observed')).toBeTruthy()
  })

  it('cloud open control opens the GitHub URL; app open control fires the deep-link IPC', async () => {
    setSessions(
      [cloud({ id: 'c1', title: 'Cloud task', htmlUrl: 'https://github.com/o/r/pull/1', updatedAt: '2026-07-02T12:00:00Z' })],
      [app({ id: 'a1', title: 'App session', updatedAt: '2026-07-02 09:00:00' })]
    )
    renderColumn()
    fireEvent.click(await screen.findByRole('button', { name: 'Copilot' }))
    await screen.findByText('Cloud task')

    fireEvent.click(screen.getByLabelText('Open on GitHub'))
    expect(openExternal).toHaveBeenCalledWith('https://github.com/o/r/pull/1')

    fireEvent.click(screen.getByLabelText('Open in Copilot app'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('copilot:open-app-session', 'a1'))
  })

  it('reveals the tab live when a copilot:updated push adds the first session', async () => {
    setSessions([], [])
    renderColumn()
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('copilot:project-app-sessions', 1))
    expect(screen.queryByRole('button', { name: 'Copilot' })).toBeNull()

    // A session appears, then the push fires — the tab should surface without a remount.
    setSessions([cloud({ id: 'c1', title: 'Fresh task' })], [])
    await act(async () => {
      copilotCallback?.()
    })

    expect(await screen.findByRole('button', { name: 'Copilot' })).toBeTruthy()
  })
})
