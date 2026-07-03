// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CopilotSession, Project } from '@shared/ipc-channels'
import { AgentTasksView } from './AgentTasksView'

const invoke = vi.fn()
const onCopilotUpdated = vi.fn(() => () => {})

beforeEach(() => {
  invoke.mockReset()
  onCopilotUpdated.mockClear()
  ;(globalThis as unknown as { window: Window }).window.electron = {
    ipc: { invoke },
    openExternal: vi.fn(() => Promise.resolve()),
    onCopilotUpdated,
  } as unknown as Window['electron']
})

function session(overrides: Partial<CopilotSession>): CopilotSession {
  return {
    id: 'x', projectId: null, source: 'github', status: 'in_progress', title: 'A task',
    htmlUrl: null, startedAt: '2026-07-02T00:00:00Z', updatedAt: '2026-07-02T00:00:00Z',
    repoOwner: 'o', repoName: 'r', branch: null, linkedPrUrl: null, pinnedProjectId: null,
    ...overrides,
  }
}

const project: Project = {
  id: 1, name: 'Alpha', notes: '', nextAction: '', status: 'active', sortOrder: 0,
  createdAt: '', updatedAt: '', unreadCount: 0, activeTodoCount: 0, snoozeMode: null,
  snoozeUntil: null, copilotStatus: null, lastFocusedAt: null, driftState: 'active',
}

function mockInvoke(sessions: CopilotSession[]): void {
  invoke.mockImplementation((channel: string) => {
    if (channel === 'copilot:unassigned') return Promise.resolve(sessions)
    if (channel === 'projects:list') return Promise.resolve([project])
    if (channel === 'copilot:assign') return Promise.resolve(undefined)
    return Promise.resolve(undefined)
  })
}

describe('AgentTasksView', () => {
  it('groups active vs completed and shows an empty state', async () => {
    mockInvoke([])
    render(<AgentTasksView />)
    expect(await screen.findByText(/No unassigned agent tasks/)).toBeTruthy()
  })

  it('lists active and completed sessions in sections', async () => {
    mockInvoke([
      session({ id: 'a', status: 'in_progress', title: 'Active one' }),
      session({ id: 'b', status: 'completed', title: 'Done one' }),
    ])
    render(<AgentTasksView />)
    expect(await screen.findByText('Active one')).toBeTruthy()
    expect(screen.getByText('Done one')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('Recently completed')).toBeTruthy()
  })

  it('assigns a session to a project', async () => {
    mockInvoke([session({ id: 'a', title: 'Active one' })])
    render(<AgentTasksView />)
    await screen.findByText('Active one')

    const select = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '1' } })

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('copilot:assign', 'a', 1))
  })
})
