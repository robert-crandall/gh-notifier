import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))
vi.mock('../db', () => ({ getDb: vi.fn() }))

import { getDb } from '../db'
import { runMigrations } from '../db/migrate'
import { createResource, getResource, upsertMcpServer, upsertProjectCard } from './registry'
import { resolveQuestion, buildDecidePrompt, type ResolveDeps } from './resolve'
import type { DecideRunner, DecideRunResult } from './copilot-run'
import type { McpRunner, McpRunResult } from './mcp-client'
import type { AssembledCandidate } from './assemble'
import type { Retriever, RetrievalOutcome } from './retrieve'
import type { ProjectCard, Resource, RetrievalMode } from '../../shared/ipc-channels'

let db: BunDb

function seedProject(name = 'Alpha'): number {
  const row = db.query('INSERT INTO projects (name, sort_order) VALUES (?, 0) RETURNING id').get(name) as { id: number }
  return row.id
}

beforeEach(() => {
  db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)
})

// ── Fake runners ──────────────────────────────────────────────────────────────

function decideRunnerReturning(content: string): DecideRunner {
  return { run: async (): Promise<DecideRunResult> => ({ ok: true, content, failure: null, reason: null }) }
}
function decideRunnerFailing(failure: DecideRunResult['failure']): DecideRunner {
  return { run: async (): Promise<DecideRunResult> => ({ ok: false, content: null, failure, reason: 'boom' }) }
}
function mcpRunnerReturning(result: McpRunResult): McpRunner {
  return { run: async (): Promise<McpRunResult> => result }
}
const mcpNeverCalled: McpRunner = {
  run: async (): Promise<McpRunResult> => {
    throw new Error('mcp runner should not have been called')
  },
}

// ── buildDecidePrompt (pure) ──────────────────────────────────────────────────

describe('buildDecidePrompt', () => {
  const card: ProjectCard = {
    projectId: 1, purpose: 'p', repos: [], services: ['checkout'], activeGoal: '', glossary: {},
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  function cand(id: number, title: string): AssembledCandidate {
    const resource = { id, title, service: 'checkout', kind: 'dashboard', source: 'datadog', aliases: [], description: '' } as unknown as Resource
    return { resource, score: 10, healthy: true }
  }

  it('assigns opaque ids and never leaks real ids into the allowed set', () => {
    const bundle = buildDecidePrompt('how is checkout?', card, [cand(42, 'A'), cand(99, 'B')])
    expect(bundle.opaqueIds).toEqual(['c1', 'c2'])
    expect(bundle.candidateByOpaqueId.get('c1')?.resource.id).toBe(42)
    expect(bundle.prompt).toContain('id: c1')
    expect(bundle.prompt).not.toContain('id: 42')
    expect(bundle.prompt).toContain('Question: how is checkout?')
  })
})

// ── resolveQuestion ───────────────────────────────────────────────────────────

describe('resolveQuestion', () => {
  function liveResource(pid: number): Resource {
    upsertMcpServer(pid, 'dd', { label: 'DD', config: { command: 'x', args: [], env: {} } })
    return createResource(pid, {
      title: 'Checkout p99 latency',
      kind: 'metric_query',
      source: 'datadog',
      service: 'checkout',
      aliases: ['checkout latency'],
      mcpServer: 'dd',
      toolName: 'query',
      toolArgs: { metric: 'checkout.p99' },
    })
  }

  const deps = (decide: DecideRunner, mcp: McpRunner): ResolveDeps => ({ decideRunner: decide, mcpRunner: mcp })

  it('returns none when no candidates match (no source saved)', async () => {
    const pid = seedProject()
    createResource(pid, { title: 'Kafka lag', service: 'ingest' })
    const res = await resolveQuestion(pid, 'quarterly revenue forecast', deps(decideRunnerReturning('{}'), mcpNeverCalled))
    expect(res.verdict).toBe('none')
    expect(res.citation).toBeNull()
  })

  it('confident: app owns the read and returns the live value', async () => {
    const pid = seedProject()
    const r = liveResource(pid)
    const res = await resolveQuestion(
      pid,
      'how is checkout latency?',
      deps(decideRunnerReturning('{"verdict":"confident","citedCandidateId":"c1"}'), mcpRunnerReturning({ ok: true, value: 'p99 240ms', failure: null, reason: null }))
    )
    expect(res.verdict).toBe('confident')
    expect(res.liveValue).toBe('p99 240ms')
    expect(res.citation?.resourceId).toBe(r.id)
    // marked used + verified
    expect(getResource(r.id)?.lastVerified).not.toBeNull()
    expect(getResource(r.id)?.validationState).toBe('valid')
  })

  it('NEVER trusts a model-reported live value (only the app-owned read)', async () => {
    const pid = seedProject()
    liveResource(pid)
    // The model tries to smuggle a liveValue; the app ignores it and uses its own read.
    const res = await resolveQuestion(
      pid,
      'checkout latency',
      deps(
        decideRunnerReturning('{"verdict":"confident","citedCandidateId":"c1","liveValue":"999 FAKE"}'),
        mcpRunnerReturning({ ok: true, value: 'p99 240ms (real)', failure: null, reason: null })
      )
    )
    expect(res.liveValue).toBe('p99 240ms (real)')
    expect(res.answer).not.toContain('FAKE')
  })

  it('confident but a bad query marks the source SUSPECT (bad source)', async () => {
    const pid = seedProject()
    const r = liveResource(pid)
    const res = await resolveQuestion(
      pid,
      'checkout latency',
      deps(decideRunnerReturning('{"verdict":"confident","citedCandidateId":"c1"}'), mcpRunnerReturning({ ok: false, value: null, failure: 'query_invalid', reason: '400' }))
    )
    expect(res.verdict).toBe('source_available_no_live_value')
    expect(res.failureClass).toBe('query_invalid')
    expect(getResource(r.id)?.suspect).toBe(true)
  })

  it('confident but an AUTH failure does NOT mark the source suspect (bad infra)', async () => {
    const pid = seedProject()
    const r = liveResource(pid)
    const res = await resolveQuestion(
      pid,
      'checkout latency',
      deps(decideRunnerReturning('{"verdict":"confident","citedCandidateId":"c1"}'), mcpRunnerReturning({ ok: false, value: null, failure: 'auth_missing', reason: '401' }))
    )
    expect(res.verdict).toBe('source_available_no_live_value')
    expect(res.failureClass).toBe('auth_missing')
    expect(getResource(r.id)?.suspect).toBe(false)
  })

  it('confident on a source with no wired MCP -> source_available_no_live_value', async () => {
    const pid = seedProject()
    const r = createResource(pid, { title: 'Runbook', kind: 'doc', service: 'checkout', aliases: ['checkout runbook'], url: 'https://x.test' })
    const res = await resolveQuestion(
      pid,
      'checkout runbook',
      deps(decideRunnerReturning('{"verdict":"confident","citedCandidateId":"c1"}'), mcpNeverCalled)
    )
    expect(res.verdict).toBe('source_available_no_live_value')
    expect(res.liveValue).toBeNull()
    expect(res.citation?.resourceId).toBe(r.id)
  })

  it('clarify returns candidate citations and no live read', async () => {
    const pid = seedProject()
    createResource(pid, { title: 'Checkout latency', service: 'checkout', aliases: ['checkout latency'] })
    createResource(pid, { title: 'Catalog latency', service: 'catalog', aliases: ['catalog latency'] })
    const res = await resolveQuestion(
      pid,
      'latency',
      deps(decideRunnerReturning('{"verdict":"clarify","clarifyQuestion":"which service?","candidateIds":["c1","c2"]}'), mcpNeverCalled)
    )
    expect(res.verdict).toBe('clarify')
    expect(res.clarifyQuestion).toBe('which service?')
    expect(res.candidates.length).toBeGreaterThanOrEqual(1)
  })

  it('a decide-call timeout fails closed WITHOUT marking any source suspect', async () => {
    const pid = seedProject()
    const r = liveResource(pid)
    const res = await resolveQuestion(pid, 'checkout latency', deps(decideRunnerFailing('timeout'), mcpNeverCalled))
    expect(res.verdict).toBe('none')
    expect(res.failureClass).toBe('timeout')
    expect(getResource(r.id)?.suspect).toBe(false)
  })

  it('a malformed model verdict fails closed to none', async () => {
    const pid = seedProject()
    liveResource(pid)
    const res = await resolveQuestion(pid, 'checkout latency', deps(decideRunnerReturning('not json'), mcpNeverCalled))
    expect(res.verdict).toBe('none')
    expect(res.failureClass).toBe('model_bad_output')
  })

  it('rejects a confident verdict citing an out-of-candidate id (fails closed)', async () => {
    const pid = seedProject()
    liveResource(pid)
    const res = await resolveQuestion(
      pid,
      'checkout latency',
      deps(decideRunnerReturning('{"verdict":"confident","citedCandidateId":"c99"}'), mcpNeverCalled)
    )
    expect(res.verdict).toBe('none')
    expect(res.failureClass).toBe('model_bad_output')
  })

  it('refuses to run an MCP server that belongs to another project', async () => {
    const projectA = seedProject('A')
    const projectB = seedProject('B')
    // Server wired under project B, but a resource in A points at it.
    upsertMcpServer(projectB, 'b-server', { label: 'B', config: { command: 'x', args: [], env: {} } })
    createResource(projectA, {
      title: 'Checkout latency',
      kind: 'metric_query',
      service: 'checkout',
      aliases: ['checkout latency'],
      mcpServer: 'b-server',
      toolName: 'query',
    })
    const res = await resolveQuestion(
      projectA,
      'checkout latency',
      deps(decideRunnerReturning('{"verdict":"confident","citedCandidateId":"c1"}'), mcpNeverCalled)
    )
    // Boundary violation is treated as a config/infra issue, not a live value.
    expect(res.verdict).toBe('source_available_no_live_value')
    expect(res.liveValue).toBeNull()
    expect(res.failureClass).toBe('connector_down')
  })

  it('treats an empty/whitespace mcpServer or toolName as no live source', async () => {
    const pid = seedProject()
    // Bad data: whitespace-only wiring should never reach an MCP call.
    createResource(pid, {
      title: 'Checkout latency',
      kind: 'metric_query',
      service: 'checkout',
      aliases: ['checkout latency'],
      mcpServer: '   ',
      toolName: ' ',
    })
    const res = await resolveQuestion(
      pid,
      'checkout latency',
      deps(decideRunnerReturning('{"verdict":"confident","citedCandidateId":"c1"}'), mcpNeverCalled)
    )
    expect(res.verdict).toBe('source_available_no_live_value')
    expect(res.liveValue).toBeNull()
  })

  it('logs every resolution to the audit table', async () => {
    const pid = seedProject()
    liveResource(pid)
    await resolveQuestion(pid, 'checkout latency', deps(decideRunnerReturning('{"verdict":"none"}'), mcpNeverCalled))
    const count = db.query('SELECT COUNT(*) AS n FROM resource_resolutions WHERE project_id = ?').get(pid) as { n: number }
    expect(count.n).toBe(1)
  })

  it('uses the project card as context but never as a citable candidate', async () => {
    const pid = seedProject()
    upsertProjectCard(pid, { purpose: 'checkout reliability', services: ['checkout'] })
    createResource(pid, { title: 'Checkout latency', service: 'checkout', aliases: ['checkout latency'] })
    // Even though the card mentions checkout, only real resources are candidates.
    const res = await resolveQuestion(
      pid,
      'checkout latency',
      deps(decideRunnerReturning('{"verdict":"confident","citedCandidateId":"c1"}'), mcpNeverCalled)
    )
    // c1 is the real resource (no wired MCP) -> source_available_no_live_value.
    expect(res.verdict).toBe('source_available_no_live_value')
    expect(res.citation?.title).toBe('Checkout latency')
  })

  // ── Retrieval-mode metadata (item #4): a degraded fallback must be observable
  //    end-to-end, so a lexical-fallback answer is distinguishable from a real
  //    semantic one on the ResolveResult itself. ──────────────────────────────
  function retrieverWithMode(mode: RetrievalMode): Retriever {
    return {
      async retrieve(_q: string, corpus: Resource[], limit: number): Promise<RetrievalOutcome> {
        const candidates = corpus.slice(0, Math.max(0, limit)).map((resource) => ({ resource, score: 1 }))
        return { candidates, mode }
      },
    }
  }

  it('threads the retrieval mode onto a confident result (degraded fallback observable)', async () => {
    const pid = seedProject()
    const r = liveResource(pid)
    const res = await resolveQuestion(pid, 'checkout latency', {
      decideRunner: decideRunnerReturning('{"verdict":"confident","citedCandidateId":"c1"}'),
      mcpRunner: mcpRunnerReturning({ ok: true, value: 'p99 240ms', failure: null, reason: null }),
      assembleOptions: { retriever: retrieverWithMode('lexical-fallback') },
    })
    expect(res.verdict).toBe('confident')
    expect(res.citation?.resourceId).toBe(r.id)
    expect(res.retrievalMode).toBe('lexical-fallback')
  })

  it('threads the retrieval mode onto a none result too', async () => {
    const pid = seedProject()
    createResource(pid, { title: 'Kafka lag', service: 'ingest' })
    const res = await resolveQuestion(pid, 'unrelated question', {
      decideRunner: decideRunnerReturning('{"verdict":"none"}'),
      mcpRunner: mcpNeverCalled,
      assembleOptions: { retriever: retrieverWithMode('semantic') },
    })
    expect(res.verdict).toBe('none')
    expect(res.retrievalMode).toBe('semantic')
  })
})
