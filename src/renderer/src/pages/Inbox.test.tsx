// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { Inbox } from './Inbox'
import type { NotificationThread, Project, RepoRuleSuggestion } from '@shared/ipc-channels'

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeThread = (overrides: Partial<NotificationThread> = {}): NotificationThread => ({
  id: 'thread-1',
  projectId: null,
  repoOwner: 'acme',
  repoName: 'widget',
  title: 'Fix the bug',
  type: 'PullRequest',
  reason: 'subscribed',
  unread: true,
  updatedAt: '2024-01-01T00:00:00Z',
  lastReadAt: null,
  apiUrl: 'https://api.github.com/notifications/threads/1',
  subjectUrl: null,
  subjectState: null,
  htmlUrl: null,
  ...overrides,
})

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 1,
  name: 'My Project',
  notes: '',
  nextAction: '',
  status: 'active',
  sortOrder: 1,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  unreadCount: 0,
  snoozeMode: null,
  snoozeUntil: null,
  ...overrides,
})

function setupElectron({
  authStatus = { authenticated: false as const },
  inbox = [] as NotificationThread[],
  projects = [] as Project[],
  lastSyncTime = null as string | null,
  assignResult = null as RepoRuleSuggestion | null,
} = {}) {
  const mockInvoke = vi.fn((channel: string) => {
    switch (channel) {
      case 'notifications:inbox': return Promise.resolve(inbox)
      case 'projects:list': return Promise.resolve(projects)
      case 'auth:status': return Promise.resolve(authStatus)
      case 'notifications:last-sync-time': return Promise.resolve(lastSyncTime)
      case 'notifications:sync': return Promise.resolve(undefined)
      case 'notifications:assign': return Promise.resolve(assignResult)
      default: return Promise.resolve(null)
    }
  })

  ;(window as unknown as Record<string, unknown>).electron = {
    ipc: { invoke: mockInvoke },
    openExternal: vi.fn(),
    onNotificationsUpdated: vi.fn(() => vi.fn()),
  }

  return mockInvoke
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Inbox', () => {
  describe('not authenticated', () => {
    it('shows a connect prompt instead of a thread list', async () => {
      setupElectron({ authStatus: { authenticated: false } })
      render(<Inbox onAssigned={vi.fn()} />)
      await waitFor(() => {
        expect(screen.getByText(/connect a github account/i)).toBeInTheDocument()
      })
      expect(screen.queryByRole('list')).not.toBeInTheDocument()
    })
  })

  describe('threads present', () => {
    it("renders each thread's title and repo", async () => {
      const threads = [
        makeThread({ id: 'thread-1', title: 'Fix the bug', repoOwner: 'acme', repoName: 'widget' }),
        makeThread({ id: 'thread-2', title: 'Add a feature', repoOwner: 'acme', repoName: 'core' }),
      ]
      setupElectron({
        authStatus: { authenticated: true, login: 'octocat', avatarUrl: '' },
        inbox: threads,
      })
      render(<Inbox onAssigned={vi.fn()} />)
      await waitFor(() => {
        expect(screen.getByText('Fix the bug')).toBeInTheDocument()
      })
      expect(screen.getByText('Add a feature')).toBeInTheDocument()
      expect(screen.getByText('acme/widget')).toBeInTheDocument()
      expect(screen.getByText('acme/core')).toBeInTheDocument()
    })
  })

  describe('sync button', () => {
    it('calls notifications:sync when the Sync button is clicked', async () => {
      const mockInvoke = setupElectron({
        authStatus: { authenticated: true, login: 'octocat', avatarUrl: '' },
      })
      render(<Inbox onAssigned={vi.fn()} />)
      // Wait for initial load to finish
      await waitFor(() => {
        expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
      })
      await userEvent.click(screen.getByRole('button', { name: /sync/i }))
      expect(mockInvoke).toHaveBeenCalledWith('notifications:sync')
    })
  })

  describe('assign dropdown', () => {
    it('calls notifications:assign with threadId and projectId when a project is selected', async () => {
      const thread = makeThread({ id: 'thread-99' })
      const project = makeProject({ id: 7, name: 'Target Project' })
      const mockInvoke = setupElectron({
        authStatus: { authenticated: true, login: 'octocat', avatarUrl: '' },
        inbox: [thread],
        projects: [project],
      })
      render(<Inbox onAssigned={vi.fn()} />)
      await waitFor(() => {
        expect(screen.getByText('Fix the bug')).toBeInTheDocument()
      })
      // Open the assign dropdown
      await userEvent.click(screen.getByRole('button', { name: /assign/i }))
      const select = screen.getByRole('combobox')
      await userEvent.selectOptions(select, String(project.id))
      expect(mockInvoke).toHaveBeenCalledWith('notifications:assign', 'thread-99', 7)
    })
  })

  describe('repo rule suggestion', () => {
    it('shows the Apply rule banner when assign returns a suggestion', async () => {
      const thread = makeThread({ id: 'thread-1' })
      const project = makeProject({ id: 3, name: 'My Project' })
      const suggestion: RepoRuleSuggestion = {
        type: 'opt-out',
        repoOwner: 'acme',
        repoName: 'widget',
        projectId: 3,
        projectName: 'My Project',
      }
      setupElectron({
        authStatus: { authenticated: true, login: 'octocat', avatarUrl: '' },
        inbox: [thread],
        projects: [project],
        assignResult: suggestion,
      })
      render(<Inbox onAssigned={vi.fn()} />)
      await waitFor(() => {
        expect(screen.getByText('Fix the bug')).toBeInTheDocument()
      })
      await userEvent.click(screen.getByRole('button', { name: /assign/i }))
      const select = screen.getByRole('combobox')
      await userEvent.selectOptions(select, String(project.id))
      await waitFor(() => {
        expect(screen.getByText(/apply rule for this repo|create a rule|always route/i)).toBeInTheDocument()
      })
    })
  })
})
