// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { ProjectCard, ServiceRunbook } from '@shared/ipc-channels'
import { normalizeServiceName } from '@shared/service-name'
import { RunbooksPanel } from './RunbooksPanel'

const invoke = vi.fn()
const onKnowledgeUpdated = vi.fn((_callback: () => void) => () => {})

// Stateful mock: the card's services array is the source of truth. `knowledge:list-for-project`
// either returns an explicit list or derives one runbook per (deduped) service so tests can
// prove the upsert-then-reload path end to end.
let cardServices: string[] = []
let runbookList: ServiceRunbook[] | 'derive' = []
let failRunbooks = false

function makeCard(services: string[]): ProjectCard {
  return { projectId: 1, purpose: '', repos: [], services, activeGoal: '', glossary: {}, updatedAt: '2026-07-10T00:00:00.000Z' }
}

function deriveRunbooks(services: string[]): ServiceRunbook[] {
  const seen = new Set<string>()
  const out: ServiceRunbook[] = []
  for (const raw of services) {
    const key = normalizeServiceName(raw)
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    out.push({ service: raw, key, status: 'missing', reason: null, markdown: null, env: null, updatedAt: null, source: null })
  }
  return out
}

function setRunbooks(list: ServiceRunbook[]): void {
  runbookList = list
}

function setCardServices(services: string[]): void {
  cardServices = services
}

function deriveMode(): void {
  runbookList = 'derive'
}

beforeEach(() => {
  invoke.mockReset()
  onKnowledgeUpdated.mockClear()
  cardServices = []
  runbookList = []
  failRunbooks = false
  invoke.mockImplementation((channel: string, ...args: unknown[]) => {
    if (channel === 'resources:card-get') return Promise.resolve(makeCard(cardServices))
    if (channel === 'resources:card-upsert') {
      const patch = args[1] as { services?: string[] }
      if (patch.services) cardServices = patch.services
      return Promise.resolve(makeCard(cardServices))
    }
    if (channel === 'knowledge:list-for-project') {
      if (failRunbooks) return Promise.reject(new Error('boom'))
      return Promise.resolve(runbookList === 'derive' ? deriveRunbooks(cardServices) : runbookList)
    }
    return Promise.resolve(undefined)
  })
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
  it('shows the services editor and an empty hint when the project has no services', async () => {
    render(<RunbooksPanel projectId={1} />)
    expect(await screen.findByLabelText('Add a service')).toBeTruthy()
    expect(screen.getByText(/No services on this project yet/i)).toBeTruthy()
  })

  it('renders a written runbook body and its metadata', async () => {
    setCardServices(['web'])
    setRunbooks([
      rb({ service: 'web', status: 'ok', markdown: '# Health\n\nHit /health.', env: 'prod', source: 'copilot', updatedAt: '2026-07-09T00:00:00.000Z' }),
    ])
    render(<RunbooksPanel projectId={1} />)
    expect(await screen.findByText('Hit /health.', { exact: false })).toBeTruthy()
    expect(screen.getByText(/source: copilot/)).toBeTruthy()
  })

  it('shows a friendly note for a service with no runbook yet', async () => {
    setCardServices(['payments-api'])
    setRunbooks([rb({ service: 'payments-api', status: 'missing' })])
    render(<RunbooksPanel projectId={1} />)
    expect(await screen.findByText(/No runbook yet/i)).toBeTruthy()
  })

  it('surfaces an invalid service name honestly', async () => {
    setCardServices(['Bad Name'])
    setRunbooks([rb({ service: 'Bad Name', key: null, status: 'invalid', reason: 'Service must be a slug.' })])
    render(<RunbooksPanel projectId={1} />)
    expect(await screen.findByText(/Service must be a slug\./)).toBeTruthy()
  })

  it('reveals a runbook file on the reveal button', async () => {
    setCardServices(['web'])
    setRunbooks([rb({ service: 'web', status: 'ok', markdown: 'body' })])
    render(<RunbooksPanel projectId={1} />)
    const revealBtn = await screen.findByTitle('Reveal file in Finder')
    fireEvent.click(revealBtn)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('knowledge:reveal', 'web'))
  })

  it('subscribes to knowledge updates', async () => {
    render(<RunbooksPanel projectId={1} />)
    await waitFor(() => expect(onKnowledgeUpdated).toHaveBeenCalled())
  })

  it('shows a runbook error (not the empty hint) when the runbook list fails to load', async () => {
    failRunbooks = true
    render(<RunbooksPanel projectId={1} />)
    expect(await screen.findByText(/Couldn’t load runbooks/i)).toBeTruthy()
    expect(screen.queryByText(/No services on this project yet/i)).toBeNull()
  })

  it('shows a card error inline but still renders runbooks when only the card fails', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'resources:card-get') return Promise.reject(new Error('nope'))
      if (channel === 'knowledge:list-for-project') {
        return Promise.resolve([rb({ service: 'web', status: 'ok', markdown: 'Hit /health.' })])
      }
      return Promise.resolve(undefined)
    })
    render(<RunbooksPanel projectId={1} />)
    expect(await screen.findByText(/Couldn’t load this project’s card/i)).toBeTruthy()
    // Editor is hidden (no card), but the runbooks that loaded fine still render.
    expect(screen.queryByLabelText('Add a service')).toBeNull()
    expect(screen.getByText('Hit /health.', { exact: false })).toBeTruthy()
  })

  it('hides stale runbook cards when a later refresh fails', async () => {
    setCardServices(['web'])
    setRunbooks([rb({ service: 'web', status: 'ok', markdown: 'Hit /health.' })])
    render(<RunbooksPanel projectId={1} />)
    expect(await screen.findByText('Hit /health.', { exact: false })).toBeTruthy()

    // A later out-of-band refresh fails: show the error, not the now-stale cards.
    failRunbooks = true
    const refresh = onKnowledgeUpdated.mock.calls[0]?.[0]
    refresh?.()

    expect(await screen.findByText(/Couldn’t load runbooks/i)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Hit /health.', { exact: false })).toBeNull())
  })

  it('adds a service: upserts the card then reloads so the runbook appears', async () => {
    deriveMode()
    render(<RunbooksPanel projectId={1} />)
    const input = await screen.findByLabelText('Add a service')
    fireEvent.change(input, { target: { value: 'usersd' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('resources:card-upsert', 1, { services: ['usersd'] }))
    // The reloaded runbook list now has an entry for the new service (unique "No runbook yet" copy).
    expect(await screen.findByText(/No runbook yet/i)).toBeTruthy()
  })

  it('removes a service: upserts without it and drops the row, with no destructive file IPC', async () => {
    setCardServices(['usersd'])
    deriveMode()
    render(<RunbooksPanel projectId={1} />)
    expect(await screen.findByText(/No runbook yet/i)).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Remove usersd'))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('resources:card-upsert', 1, { services: [] }))
    await waitFor(() => expect(screen.queryByText(/No runbook yet/i)).toBeNull())

    // Removal only edits the card list: no reveal/delete-style IPC was ever called.
    const channels = invoke.mock.calls.map((c) => c[0])
    expect(channels).not.toContain('knowledge:reveal')
    expect(new Set(channels)).toEqual(new Set(['resources:card-get', 'knowledge:list-for-project', 'resources:card-upsert']))
  })
})
