// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CopilotAppSession } from '@shared/ipc-channels'
import { TodoSessionChip } from './TodoSessionChip'

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue(undefined)
  ;(globalThis as unknown as { window: Window }).window.electron = {
    ipc: { invoke },
  } as unknown as Window['electron']
})

function session(overrides: Partial<CopilotAppSession> = {}): CopilotAppSession {
  return {
    id: 'app-1', projectId: 1, cwd: '/x', title: 't', status: 'in_progress',
    repoOwner: null, repoName: null, origin: 'launched', pinnedProjectId: null,
    createdAt: '', updatedAt: '', ...overrides,
  }
}

describe('TodoSessionChip', () => {
  it('shows honest copy per status', () => {
    const { rerender } = render(<TodoSessionChip session={session({ status: 'in_progress' })} />)
    expect(screen.getByText('Copilot working on this')).toBeTruthy()
    rerender(<TodoSessionChip session={session({ status: 'waiting' })} />)
    expect(screen.getByText('Copilot idle')).toBeTruthy() // not "needs you"
    rerender(<TodoSessionChip session={session({ status: 'unknown' })} />)
    expect(screen.getByText('Copilot session')).toBeTruthy()
  })

  it('opens the session in the app on click', () => {
    render(<TodoSessionChip session={session({ id: 'abc-123' })} />)
    fireEvent.click(screen.getByRole('button'))
    expect(invoke).toHaveBeenCalledWith('copilot:open-app-session', 'abc-123')
  })
})
