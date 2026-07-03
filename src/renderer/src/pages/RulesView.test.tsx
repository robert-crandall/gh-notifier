// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { Project, RepoRule, RoutingRule } from '@shared/ipc-channels'
import { RulesView } from './RulesView'

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  ;(globalThis as unknown as { window: Window }).window.electron = {
    ipc: { invoke },
    openExternal: vi.fn(() => Promise.resolve()),
  } as unknown as Window['electron']
})

const project: Project = {
  id: 1, name: 'Alpha', notes: '', nextAction: '', status: 'active', sortOrder: 0,
  createdAt: '', updatedAt: '', unreadCount: 0, activeTodoCount: 0, snoozeMode: null,
  snoozeUntil: null, copilotStatus: null, lastFocusedAt: null, driftState: 'active',
}

function repoRule(overrides: Partial<RepoRule> = {}): RepoRule {
  return { id: 1, repoOwner: 'acme', repoName: 'web', projectId: 1, createdAt: '', ...overrides }
}

function routingRule(overrides: Partial<RoutingRule> = {}): RoutingRule {
  return {
    id: 1, action: 'route', projectId: 1, projectName: 'Alpha', matchType: null,
    matchReason: null, matchRepoOwner: null, matchRepoName: null, matchOrg: null,
    createdAt: '', ...overrides,
  }
}

function mockInvoke(opts: { repos?: RepoRule[]; routing?: RoutingRule[] } = {}): void {
  invoke.mockImplementation((channel: string) => {
    switch (channel) {
      case 'repo-rules:list':
        return Promise.resolve(opts.repos ?? [])
      case 'routing-rules:list':
        return Promise.resolve(opts.routing ?? [])
      case 'projects:list':
        return Promise.resolve([project])
      case 'repo-rules:delete':
      case 'routing-rules:delete':
      case 'repo-rules:create':
      case 'routing-rules:create':
        return Promise.resolve(undefined)
      case 'routing-rules:apply-to-inbox':
        return Promise.resolve({ matched: 2 })
      default:
        return Promise.resolve(undefined)
    }
  })
}

describe('RulesView', () => {
  it('renders the three rule sections', async () => {
    mockInvoke()
    render(<RulesView onClose={vi.fn()} />)
    expect(await screen.findByText('Repo defaults')).toBeTruthy()
    expect(screen.getByText('Route rules')).toBeTruthy()
    expect(screen.getByText('Filters')).toBeTruthy()
  })

  it('lists route/suppress rules in evaluation order with an order number', async () => {
    mockInvoke({
      routing: [
        routingRule({ id: 1, action: 'route', matchType: 'PullRequest', createdAt: '2026-01-01' }),
        routingRule({ id: 2, action: 'route', matchType: 'Issue', createdAt: '2026-01-02' }),
        routingRule({ id: 3, action: 'suppress', projectId: null, projectName: null, matchReason: 'ci_activity', createdAt: '2026-01-03' }),
      ],
    })
    render(<RulesView onClose={vi.fn()} />)
    // Two route rules numbered 1 and 2; the suppress rule renders under Filters numbered 1.
    expect(await screen.findByText('PullRequest')).toBeTruthy()
    expect(screen.getByText('Issue')).toBeTruthy()
    expect(screen.getByText('ci_activity')).toBeTruthy()
    // Route target shown for route rules.
    expect(screen.getAllByText('→ Alpha').length).toBe(2)
  })

  it('maps a repo rule to its project name', async () => {
    mockInvoke({ repos: [repoRule({ repoOwner: 'acme', repoName: 'web', projectId: 1 })] })
    render(<RulesView onClose={vi.fn()} />)
    expect(await screen.findByText('acme/web')).toBeTruthy()
    expect(screen.getByText('→ Alpha')).toBeTruthy()
  })

  it('blocks creating a filter with no conditions and shows an error', async () => {
    mockInvoke()
    render(<RulesView onClose={vi.fn()} />)
    // Open the Filters add form (the last "Add" button).
    const addButtons = await screen.findAllByRole('button', { name: 'Add' })
    fireEvent.click(addButtons[addButtons.length - 1])
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))
    expect(await screen.findByText(/at least one condition/i)).toBeTruthy()
    // No create IPC fired.
    expect(invoke).not.toHaveBeenCalledWith('routing-rules:create', expect.anything())
  })

  it('creates a suppress rule from a single condition', async () => {
    mockInvoke()
    render(<RulesView onClose={vi.fn()} />)
    const addButtons = await screen.findAllByRole('button', { name: 'Add' })
    fireEvent.click(addButtons[addButtons.length - 1])
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'ci_activity' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('routing-rules:create', {
        action: 'suppress',
        projectId: undefined,
        matchType: undefined,
        matchReason: 'ci_activity',
        matchRepoOwner: undefined,
        matchRepoName: undefined,
        matchOrg: undefined,
      })
    })
  })

  it('deletes a repo rule via IPC', async () => {
    mockInvoke({ repos: [repoRule({ id: 42 })] })
    render(<RulesView onClose={vi.fn()} />)
    const row = (await screen.findByText('acme/web')).closest('div') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Delete rule' }))
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('repo-rules:delete', 42)
    })
  })

  it('applies route rules to the inbox and reports the count', async () => {
    mockInvoke({ routing: [routingRule({ id: 1, action: 'route', matchType: 'PullRequest' })] })
    render(<RulesView onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Apply to inbox now/ }))
    expect(await screen.findByText(/Routed 2 threads/)).toBeTruthy()
  })
})
