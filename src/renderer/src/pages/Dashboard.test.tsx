// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { Dashboard } from './Dashboard'
import type { Project } from '@shared/ipc-channels'

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

beforeEach(() => {
  ;(window as unknown as Record<string, unknown>).electron = {
    ipc: { invoke: vi.fn() },
    openExternal: vi.fn(),
    onNotificationsUpdated: vi.fn(() => vi.fn()),
  }
})

describe('Dashboard', () => {
  describe('no projects', () => {
    it('renders an empty state message', () => {
      render(
        <Dashboard projects={[]} onSelectProject={vi.fn()} onCreateProject={vi.fn()} />
      )
      expect(screen.getByText(/no projects yet/i)).toBeInTheDocument()
    })
  })

  describe('focus banner', () => {
    it('renders the focus banner with the project name when the first active project has a nextAction', () => {
      const project = makeProject({ name: 'Alpha', nextAction: 'Write the spec' })
      render(
        <Dashboard
          projects={[project]}
          onSelectProject={vi.fn()}
          onCreateProject={vi.fn()}
        />
      )
      const banner = screen.getByRole('button', { name: /focus now · alpha/i })
      expect(banner).toBeInTheDocument()
      expect(within(banner).getByText('Write the spec')).toBeInTheDocument()
    })

    it('does not render a focus banner when no active project has a nextAction', () => {
      const project = makeProject({ name: 'Beta', nextAction: '' })
      render(
        <Dashboard
          projects={[project]}
          onSelectProject={vi.fn()}
          onCreateProject={vi.fn()}
        />
      )
      expect(screen.queryByText(/focus now/i)).not.toBeInTheDocument()
    })
  })

  describe('multiple active projects', () => {
    it('renders all active projects in the provided sort order', () => {
      const projects = [
        makeProject({ id: 1, name: 'First', sortOrder: 1 }),
        makeProject({ id: 2, name: 'Second', sortOrder: 2 }),
        makeProject({ id: 3, name: 'Third', sortOrder: 3 }),
      ]
      render(
        <Dashboard projects={projects} onSelectProject={vi.fn()} onCreateProject={vi.fn()} />
      )
      const items = screen.getAllByRole('listitem')
      expect(items[0]).toHaveTextContent('First')
      expect(items[1]).toHaveTextContent('Second')
      expect(items[2]).toHaveTextContent('Third')
    })
  })

  describe('snoozed projects', () => {
    it('renders the snoozed count but not the snoozed project in the active list', () => {
      const active = makeProject({ id: 1, name: 'ActiveOne', status: 'active' })
      const snoozed = makeProject({ id: 2, name: 'SnoozedOne', status: 'snoozed', snoozeMode: 'manual' })
      render(
        <Dashboard
          projects={[active, snoozed]}
          onSelectProject={vi.fn()}
          onCreateProject={vi.fn()}
        />
      )
      // Snoozed section summary is shown
      expect(screen.getByText(/1 snoozed project/i)).toBeInTheDocument()
      // Active list only contains the active project
      const list = screen.getByRole('list')
      expect(list).toHaveTextContent('ActiveOne')
      expect(list).not.toHaveTextContent('SnoozedOne')
    })
  })

  describe('new project form', () => {
    it('shows the inline input when the New project button is clicked', async () => {
      render(
        <Dashboard projects={[]} onSelectProject={vi.fn()} onCreateProject={vi.fn()} />
      )
      await userEvent.click(screen.getByRole('button', { name: /\+ new project/i }))
      expect(screen.getByPlaceholderText(/project name/i)).toBeInTheDocument()
    })

    it('calls onCreateProject with the entered name when Create is clicked', async () => {
      const newProject = makeProject({ id: 99, name: 'Widget' })
      const onCreateProject = vi.fn().mockResolvedValue(newProject)
      render(
        <Dashboard
          projects={[]}
          onSelectProject={vi.fn()}
          onCreateProject={onCreateProject}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /\+ new project/i }))
      await userEvent.type(screen.getByPlaceholderText(/project name/i), 'Widget')
      await userEvent.click(screen.getByRole('button', { name: /create/i }))
      expect(onCreateProject).toHaveBeenCalledWith('Widget')
    })

    it('calls onCreateProject when Enter is pressed in the input', async () => {
      const newProject = makeProject({ id: 99, name: 'Widget' })
      const onCreateProject = vi.fn().mockResolvedValue(newProject)
      render(
        <Dashboard
          projects={[]}
          onSelectProject={vi.fn()}
          onCreateProject={onCreateProject}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /\+ new project/i }))
      await userEvent.type(screen.getByPlaceholderText(/project name/i), 'Widget{Enter}')
      expect(onCreateProject).toHaveBeenCalledWith('Widget')
    })
  })
})
