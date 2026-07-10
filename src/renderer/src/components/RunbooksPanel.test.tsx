// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { ServiceRunbook } from '@shared/ipc-channels'
import { RunbooksPanel } from './RunbooksPanel'

const invoke = vi.fn()
const onKnowledgeUpdated = vi.fn(() => () => {})

function setRunbooks(list: ServiceRunbook[]): void {
  invoke.mockImplementation((channel: string) => {
    if (channel === 'knowledge:list-for-project') return Promise.resolve(list)
    return Promise.resolve(undefined)
  })
}

beforeEach(() => {
  invoke.mockReset()
  onKnowledgeUpdated.mockClear()
  setRunbooks([])
  ;(globalThis as unknown as { window: Window }).window.electron = {
    ipc: { invoke },
    openExternal: vi.fn(() => Promise.resolve()),
    onKnowledgeUpdated,
  } as unknown as Window['electron']
})

function rb(partial: Partial<ServiceRunbook> & Pick<ServiceRunbook, 'service' | 'status'>): ServiceRunbook {
  return {
    service: partial.service,
    key: partial.key ?? partial.service,
    status: partial.status,
    reason: partial.reason ?? null,
    markdown: partial.markdown ?? null,
    env: partial.env ?? null,
    updatedAt: partial.updatedAt ?? null,
    source: partial.source ?? null,
  }
}

describe('RunbooksPanel', () => {
  it('renders an empty state when the project has no services', async () => {
    setRunbooks([])
    render(<RunbooksPanel projectId={1} />)
    expect(await screen.findByText(/lists no services yet/i)).toBeTruthy()
  })

  it('renders a written runbook body and its metadata', async () => {
    setRunbooks([
      rb({ service: 'web', status: 'ok', markdown: '# Health\n\nHit /health.', env: 'prod', source: 'copilot', updatedAt: '2026-07-09T00:00:00.000Z' }),
    ])
    render(<RunbooksPanel projectId={1} />)
    expect(await screen.findByText('web')).toBeTruthy()
    expect(screen.getByText(/Hit \/health\./)).toBeTruthy()
    expect(screen.getByText(/source: copilot/)).toBeTruthy()
  })

  it('shows a friendly note for a service with no runbook yet', async () => {
    setRunbooks([rb({ service: 'payments-api', status: 'missing' })])
    render(<RunbooksPanel projectId={1} />)
    expect(await screen.findByText(/No runbook yet/i)).toBeTruthy()
  })

  it('surfaces an invalid service name honestly', async () => {
    setRunbooks([rb({ service: 'Bad Name', key: null, status: 'invalid', reason: 'Service must be a slug.' })])
    render(<RunbooksPanel projectId={1} />)
    expect(await screen.findByText(/Service must be a slug\./)).toBeTruthy()
  })

  it('reveals a runbook file on the reveal button', async () => {
    setRunbooks([rb({ service: 'web', status: 'ok', markdown: 'body' })])
    render(<RunbooksPanel projectId={1} />)
    const revealBtn = await screen.findByTitle('Reveal file in Finder')
    fireEvent.click(revealBtn)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('knowledge:reveal', 'web'))
  })

  it('subscribes to knowledge updates', async () => {
    setRunbooks([])
    render(<RunbooksPanel projectId={1} />)
    await waitFor(() => expect(onKnowledgeUpdated).toHaveBeenCalled())
  })
})
