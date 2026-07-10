// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CopilotSession, Project, RepoRuleSuggestion } from '@shared/ipc-channels'
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

function mockInvoke(sessions: CopilotSession[], assignResult: RepoRuleSuggestion | null = null): void {
  invoke.mockImplementation((channel: string) => {
    if (channel === 'copilot:unassigned') return Promise.resolve(sessions)
    if (channel === 'projects:list') return Promise.resolve([project])
    if (channel === 'copilot:assign') return Promise.resolve(assignResult)
    if (channel === 'repo-rules:create') return Promise.resolve(undefined)
    return Promise.resolve(undefined)
  })
}

const optInSuggestion: RepoRuleSuggestion = {
  type: 'opt-in', repoOwner: 'o', repoName: 'r', projectId: 1, projectName: 'Alpha',
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

  it('offers to remember the repo and creates the rule on accept', async () => {
    mockInvoke([session({ id: 'a', title: 'Active one', repoOwner: 'o', repoName: 'r' })], optInSuggestion)
    render(<AgentTasksView />)
    await screen.findByText('Active one')

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } })

    // Banner surfaces after assign returns a suggestion.
    await screen.findByText(/Always route o\/r to/)
    fireEvent.click(screen.getByText('Remember repo'))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('repo-rules:create', 'o', 'r', 1))
    // Banner clears after accepting.
    await waitFor(() => expect(screen.queryByText(/Always route o\/r to/)).toBeNull())
  })

  it('dismisses the suggestion without creating a rule', async () => {
    mockInvoke([session({ id: 'a', title: 'Active one', repoOwner: 'o', repoName: 'r' })], optInSuggestion)
    render(<AgentTasksView />)
    await screen.findByText('Active one')

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } })
    await screen.findByText(/Always route o\/r to/)

    fireEvent.click(screen.getByText('No thanks'))

    await waitFor(() => expect(screen.queryByText(/Always route o\/r to/)).toBeNull())
    expect(invoke).not.toHaveBeenCalledWith('repo-rules:create', 'o', 'r', 1)
  })

  it('shows no banner when assign returns no suggestion', async () => {
    mockInvoke([session({ id: 'a', title: 'Active one' })], null)
    render(<AgentTasksView />)
    await screen.findByText('Active one')

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } })

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('copilot:assign', 'a', 1))
    expect(screen.queryByText(/Always route/)).toBeNull()
  })

  it('clears a stale banner when a later assignment returns no suggestion', async () => {
    // First assign surfaces a banner; a second assign of a different session in an
    // already-mapped repo returns null and must clear the older banner.
    invoke.mockImplementation((channel: string, _id?: string) => {
      if (channel === 'copilot:unassigned') {
        return Promise.resolve([
          session({ id: 'a', title: 'First', repoOwner: 'o', repoName: 'r' }),
          session({ id: 'b', title: 'Second', repoOwner: 'o', repoName: 'r' }),
        ])
      }
      if (channel === 'projects:list') return Promise.resolve([project])
      if (channel === 'copilot:assign') return Promise.resolve(_id === 'a' ? optInSuggestion : null)
      if (channel === 'repo-rules:create') return Promise.resolve(undefined)
      return Promise.resolve(undefined)
    })
    render(<AgentTasksView />)
    await screen.findByText('First')

    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: '1' } })
    await screen.findByText(/Always route o\/r to/)

    // Row 'a' is optimistically removed; assign the remaining session 'b', whose
    // assign returns null → the older banner must clear.
    const remaining = screen.getAllByRole('combobox')
    fireEvent.change(remaining[remaining.length - 1], { target: { value: '1' } })
    await waitFor(() => expect(screen.queryByText(/Always route o\/r to/)).toBeNull())
  })
})
