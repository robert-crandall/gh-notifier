// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { CopilotSessionRow } from '../hooks/useCopilotSessions'
import { CopilotSessionsPanel } from './CopilotSessionsPanel'

beforeEach(() => {
  ;(globalThis as unknown as { window: Window }).window.electron = {
    ipc: { invoke: vi.fn(() => Promise.resolve()) },
    openExternal: vi.fn(() => Promise.resolve()),
  } as unknown as Window['electron']
})

function row(overrides: Partial<CopilotSessionRow>): CopilotSessionRow {
  return {
    key: 'cloud:c',
    kind: 'cloud',
    title: 'A session',
    status: 'in_progress',
    startedAt: '2026-07-01T00:00:00Z',
    updatedAtMs: Date.parse('2026-07-01T00:00:00Z'),
    githubUrl: null,
    appSessionId: null,
    origin: null,
    ...overrides,
  }
}

describe('CopilotSessionsPanel empty states', () => {
  it('shows the definitive "no sessions" copy only on an authoritative empty', () => {
    render(<CopilotSessionsPanel rows={[]} emptyIsAuthoritative={true} />)
    expect(screen.getByText(/No Copilot sessions/i)).toBeTruthy()
  })

  it('stays indeterminate (never "no sessions") on a non-authoritative empty', () => {
    // Covers both the initial load and a transient/failed load while the tab is pinned:
    // a failure must never present as a confirmed empty.
    render(<CopilotSessionsPanel rows={[]} emptyIsAuthoritative={false} />)
    expect(screen.queryByText(/No Copilot sessions/i)).toBeNull()
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('renders the session list when rows are present', () => {
    render(<CopilotSessionsPanel rows={[row({ title: 'My session' })]} emptyIsAuthoritative={false} />)
    expect(screen.getByText('My session')).toBeTruthy()
    expect(screen.queryByText(/No Copilot sessions/i)).toBeNull()
  })
})
