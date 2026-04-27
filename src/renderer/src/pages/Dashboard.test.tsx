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
  activeTodoCount: 0,
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
        <Dashboard projects={[]} onSelectProject={vi.fn()} onCreateProject={vi.fn()} onUpdateProject={vi.fn()} onDeleteProject={vi.fn()} />
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
          onUpdateProject={vi.fn()}
          onDeleteProject={vi.fn()}
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
          onUpdateProject={vi.fn()}
          onDeleteProject={vi.fn()}
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
        <Dashboard projects={projects} onSelectProject={vi.fn()} onCreateProject={vi.fn()} onUpdateProject={vi.fn()} onDeleteProject={vi.fn()} />
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
          onUpdateProject={vi.fn()}
          onDeleteProject={vi.fn()}
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
        <Dashboard projects={[]} onSelectProject={vi.fn()} onCreateProject={vi.fn()} onUpdateProject={vi.fn()} onDeleteProject={vi.fn()} />
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
          onUpdateProject={vi.fn()}
          onDeleteProject={vi.fn()}
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
          onUpdateProject={vi.fn()}
          onDeleteProject={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /\+ new project/i }))
      await userEvent.type(screen.getByPlaceholderText(/project name/i), 'Widget{Enter}')
      expect(onCreateProject).toHaveBeenCalledWith('Widget')
    })
  })

  describe('rename project', () => {
    it('shows the inline input when the rename button is clicked', async () => {
      const project = makeProject({ id: 1, name: 'Original Name' })
      render(
        <Dashboard
          projects={[project]}
          onSelectProject={vi.fn()}
          onCreateProject={vi.fn()}
          onUpdateProject={vi.fn()}
          onDeleteProject={vi.fn()}
        />
      )
      const renameButton = screen.getByRole('button', { name: /rename original name/i })
      await userEvent.click(renameButton)
      const input = screen.getByDisplayValue('Original Name')
      expect(input).toBeInTheDocument()
      expect(input).toHaveFocus()
    })

    it('calls onUpdateProject with new name when Enter is pressed', async () => {
      const project = makeProject({ id: 1, name: 'Original Name' })
      const onUpdateProject = vi.fn().mockResolvedValue({ ...project, name: 'New Name' })
      render(
        <Dashboard
          projects={[project]}
          onSelectProject={vi.fn()}
          onCreateProject={vi.fn()}
          onUpdateProject={onUpdateProject}
          onDeleteProject={vi.fn()}
        />
      )
      const renameButton = screen.getByRole('button', { name: /rename original name/i })
      await userEvent.click(renameButton)
      const input = screen.getByDisplayValue('Original Name')
      await userEvent.clear(input)
      await userEvent.type(input, 'New Name{Enter}')
      expect(onUpdateProject).toHaveBeenCalledWith(1, { name: 'New Name' })
    })

    it('calls onUpdateProject with new name when input loses focus', async () => {
      const project = makeProject({ id: 1, name: 'Original Name' })
      const onUpdateProject = vi.fn().mockResolvedValue({ ...project, name: 'Changed' })
      render(
        <Dashboard
          projects={[project]}
          onSelectProject={vi.fn()}
          onCreateProject={vi.fn()}
          onUpdateProject={onUpdateProject}
          onDeleteProject={vi.fn()}
        />
      )
      const renameButton = screen.getByRole('button', { name: /rename original name/i })
      await userEvent.click(renameButton)
      const input = screen.getByDisplayValue('Original Name')
      await userEvent.clear(input)
      await userEvent.type(input, 'Changed')
      input.blur()
      expect(onUpdateProject).toHaveBeenCalledWith(1, { name: 'Changed' })
    })

    it('does not call onUpdateProject when name is unchanged', async () => {
      const project = makeProject({ id: 1, name: 'Same Name' })
      const onUpdateProject = vi.fn()
      render(
        <Dashboard
          projects={[project]}
          onSelectProject={vi.fn()}
          onCreateProject={vi.fn()}
          onUpdateProject={onUpdateProject}
          onDeleteProject={vi.fn()}
        />
      )
      const renameButton = screen.getByRole('button', { name: /rename same name/i })
      await userEvent.click(renameButton)
      const input = screen.getByDisplayValue('Same Name')
      await userEvent.type(input, '{Enter}')
      expect(onUpdateProject).not.toHaveBeenCalled()
    })
  })

  describe('delete project', () => {
    it('shows confirmation dialog when delete button is clicked', async () => {
      const project = makeProject({ id: 1, name: 'To Delete' })
      render(
        <Dashboard
          projects={[project]}
          onSelectProject={vi.fn()}
          onCreateProject={vi.fn()}
          onUpdateProject={vi.fn()}
          onDeleteProject={vi.fn()}
        />
      )
      const deleteButton = screen.getByRole('button', { name: /delete to delete/i })
      await userEvent.click(deleteButton)
      expect(screen.getByText(/to delete/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })

    it('calls onDeleteProject when delete is confirmed', async () => {
      const project = makeProject({ id: 1, name: 'To Delete' })
      const onDeleteProject = vi.fn().mockResolvedValue(undefined)
      render(
        <Dashboard
          projects={[project]}
          onSelectProject={vi.fn()}
          onCreateProject={vi.fn()}
          onUpdateProject={vi.fn()}
          onDeleteProject={onDeleteProject}
        />
      )
      const deleteButton = screen.getByRole('button', { name: /delete to delete/i })
      await userEvent.click(deleteButton)
      const confirmButton = screen.getByRole('button', { name: /^delete$/i })
      await userEvent.click(confirmButton)
      expect(onDeleteProject).toHaveBeenCalledWith(1)
    })

    it('does not call onDeleteProject when delete is cancelled', async () => {
      const project = makeProject({ id: 1, name: 'To Delete' })
      const onDeleteProject = vi.fn()
      render(
        <Dashboard
          projects={[project]}
          onSelectProject={vi.fn()}
          onCreateProject={vi.fn()}
          onUpdateProject={vi.fn()}
          onDeleteProject={onDeleteProject}
        />
      )
      const deleteButton = screen.getByRole('button', { name: /delete to delete/i })
      await userEvent.click(deleteButton)
      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      await userEvent.click(cancelButton)
      expect(onDeleteProject).not.toHaveBeenCalled()
      expect(screen.queryByText(/delete "to delete"\?/i)).not.toBeInTheDocument()
    })
  })
})