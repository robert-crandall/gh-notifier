// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Project } from '@shared/ipc-channels'
import { ResurfaceStrip } from './ResurfaceStrip'

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: 'blog-2025',
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
    driftState: 'drifting',
    ...overrides,
  }
}

describe('ResurfaceStrip', () => {
  it('renders nothing when nothing is drifting', () => {
    const { container } = render(
      <ResurfaceStrip drifting={[]} onSelect={vi.fn()} onPark={vi.fn()} onSnooze={vi.fn()} onNotNow={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('caps the strip at three drifting projects', () => {
    const drifting = [1, 2, 3, 4, 5].map((id) => project({ id, name: `p${id}` }))
    render(<ResurfaceStrip drifting={drifting} onSelect={vi.fn()} onPark={vi.fn()} onSnooze={vi.fn()} onNotNow={vi.fn()} />)
    expect(screen.getByText('p1')).toBeTruthy()
    expect(screen.getByText('p3')).toBeTruthy()
    expect(screen.queryByText('p4')).toBeNull()
  })

  it('wires park, snooze, and not-now actions', () => {
    const onPark = vi.fn()
    const onSnooze = vi.fn()
    const onNotNow = vi.fn()
    const p = project({ id: 7, name: 'drifty' })
    render(<ResurfaceStrip drifting={[p]} onSelect={vi.fn()} onPark={onPark} onSnooze={onSnooze} onNotNow={onNotNow} />)
    fireEvent.click(screen.getByText('Park'))
    fireEvent.click(screen.getByText('Snooze'))
    fireEvent.click(screen.getByText('Not now'))
    expect(onPark).toHaveBeenCalledWith(p)
    expect(onSnooze).toHaveBeenCalledWith(p)
    expect(onNotNow).toHaveBeenCalledWith(p)
  })

  it('selects a project when its name is clicked', () => {
    const onSelect = vi.fn()
    render(<ResurfaceStrip drifting={[project({ id: 9, name: 'pick-me' })]} onSelect={onSelect} onPark={vi.fn()} onSnooze={vi.fn()} onNotNow={vi.fn()} />)
    fireEvent.click(screen.getByText('pick-me'))
    expect(onSelect).toHaveBeenCalledWith(9)
  })
})
