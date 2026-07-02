// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Project } from '@shared/ipc-channels'
import { CommandPalette } from './CommandPalette'

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: 'sync-engine',
    notes: '',
    nextAction: '',
    status: 'active',
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    unreadCount: 0,
    activeTodoCount: 0,
    snoozeMode: null,
    snoozeUntil: null,
    copilotStatus: null,
    lastFocusedAt: null,
    driftState: 'active',
    ...overrides,
  }
}

const projects = [project({ id: 1, name: 'sync-engine' }), project({ id: 2, name: 'mesh-gateway' })]

function renderPalette(overrides: Partial<Parameters<typeof CommandPalette>[0]> = {}): {
  onSelectProject: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
} {
  const onSelectProject = vi.fn()
  const onClose = vi.fn()
  render(
    <CommandPalette
      open
      projects={projects}
      onClose={onClose}
      onSelectProject={onSelectProject}
      onOpenInbox={vi.fn()}
      onOpenSettings={vi.fn()}
      onNewProject={vi.fn()}
      {...overrides}
    />
  )
  return { onSelectProject, onClose }
}

describe('CommandPalette', () => {
  it('lists projects and actions when open', () => {
    renderPalette()
    expect(screen.getByText('sync-engine')).toBeTruthy()
    expect(screen.getByText('mesh-gateway')).toBeTruthy()
    expect(screen.getByText('Open Inbox')).toBeTruthy()
    expect(screen.getByText('New project')).toBeTruthy()
  })

  it('filters entries by the query', () => {
    renderPalette()
    fireEvent.change(screen.getByPlaceholderText(/Jump to a project/), { target: { value: 'mesh' } })
    expect(screen.getByText('mesh-gateway')).toBeTruthy()
    expect(screen.queryByText('sync-engine')).toBeNull()
  })

  it('selects the filtered project on Enter', () => {
    const { onSelectProject } = renderPalette()
    const input = screen.getByPlaceholderText(/Jump to a project/)
    fireEvent.change(input, { target: { value: 'mesh' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelectProject).toHaveBeenCalledWith(2)
  })

  it('closes on Escape', () => {
    const { onClose } = renderPalette()
    fireEvent.keyDown(screen.getByPlaceholderText(/Jump to a project/), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <CommandPalette
        open={false}
        projects={projects}
        onClose={vi.fn()}
        onSelectProject={vi.fn()}
        onOpenInbox={vi.fn()}
        onOpenSettings={vi.fn()}
        onNewProject={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })
})
