import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))
vi.mock('../db', () => ({ getDb: vi.fn() }))

import { getDb } from '../db'
import { runMigrations } from '../db/migrate'
import { createResource } from './registry'
import {
  buildRecommendPrompt,
  parseAndValidateRecommendationIds,
  metadataWhy,
  recommendResources,
  type RecommendDeps,
} from './recommend'
import type { DecideRunner, DecideRunResult } from './copilot-run'
import type { AssembledCandidate } from './assemble'
import type { Retriever, RetrievalOutcome } from './retrieve'
import type { ProjectCard, Resource, RetrievalMode } from '../../shared/ipc-channels'

// ── Pure: buildRecommendPrompt ────────────────────────────────────────────────

const card: ProjectCard = {
  projectId: 1, purpose: 'checkout service', repos: [], services: ['checkout'], activeGoal: '', glossary: {},
  updatedAt: '2026-01-01T00:00:00.000Z',
}
function cand(id: number, title: string): AssembledCandidate {
  const resource = { id, title, service: 'checkout', env: 'prod', kind: 'dashboard', source: 'datadog', aliases: [], description: '' } as unknown as Resource
  return { resource, score: 10, healthy: true }
}

describe('buildRecommendPrompt', () => {
  it('uses opaque ids only, asks for ids-only JSON, and labels metadata untrusted', () => {
    const b = buildRecommendPrompt('what should I monitor?', card, [cand(42, 'Errors'), cand(99, 'Latency')])
    expect(b.opaqueIds).toEqual(['c1', 'c2'])
    expect(b.candidateByOpaqueId.get('c1')?.resource.id).toBe(42)
    expect(b.prompt).toContain('id: c1')
    expect(b.prompt).not.toContain('id: 42')
    expect(b.prompt).toContain('{"ids":["c1","c3"]}')
    expect(b.prompt.toLowerCase()).toContain('untrusted')
    expect(b.prompt).toContain('Question: what should I monitor?')
  })
})

// ── Pure: validator (fails closed) ────────────────────────────────────────────

describe('parseAndValidateRecommendationIds', () => {
  const allowed = ['c1', 'c2', 'c3']

  it('accepts a valid ordered subset and dedupes', () => {
    expect(parseAndValidateRecommendationIds('{"ids":["c3","c1","c1"]}', allowed)).toEqual({ ok: true, ids: ['c3', 'c1'] })
  })

  it('accepts an empty list as a legitimate success', () => {
    expect(parseAndValidateRecommendationIds('{"ids":[]}', allowed)).toEqual({ ok: true, ids: [] })
  })

  it('FAILS CLOSED on any unknown id (not silent filter)', () => {
    const r = parseAndValidateRecommendationIds('{"ids":["c1","c9"]}', allowed)
    expect(r.ok).toBe(false)
  })

  it('fails closed on malformed / wrong-shape output', () => {
    expect(parseAndValidateRecommendationIds('', allowed).ok).toBe(false)
    expect(parseAndValidateRecommendationIds('not json', allowed).ok).toBe(false)
    expect(parseAndValidateRecommendationIds('["c1"]', allowed).ok).toBe(false) // not an object
    expect(parseAndValidateRecommendationIds('{"ids":"c1"}', allowed).ok).toBe(false) // not an array
    expect(parseAndValidateRecommendationIds('{"ids":[1,2]}', allowed).ok).toBe(false) // non-string
  })
})

// ── Pure: metadataWhy ─────────────────────────────────────────────────────────

describe('metadataWhy', () => {
  it('builds provenance facets from metadata, with a description snippet', () => {
    const r = { kind: 'dashboard', service: 'billing', env: 'prod', description: 'Error rate + p99' } as unknown as Resource
    expect(metadataWhy(r)).toBe('dashboard · service billing · env prod — Error rate + p99')
  })
  it('omits empty facets', () => {
    const r = { kind: 'doc', service: '', env: '', description: '' } as unknown as Resource
    expect(metadataWhy(r)).toBe('doc')
  })
})

// ── Integration: recommendResources ───────────────────────────────────────────

let db: BunDb

beforeEach(() => {
  db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)
})

function seedProject(name = 'Alpha'): number {
  return (db.query('INSERT INTO projects (name, sort_order) VALUES (?, 0) RETURNING id').get(name) as { id: number }).id
}
function allRetriever(mode: RetrievalMode = 'semantic'): Retriever {
  return {
    async retrieve(_q: string, corpus: Resource[], limit: number): Promise<RetrievalOutcome> {
      return { candidates: corpus.slice(0, Math.max(0, limit)).map((resource) => ({ resource, score: 1 })), mode }
    },
  }
}
function runnerReturning(content: string): DecideRunner {
  return { run: async (): Promise<DecideRunResult> => ({ ok: true, content, failure: null, reason: null }) }
}
function runnerFailing(failure: DecideRunResult['failure']): DecideRunner {
  return { run: async (): Promise<DecideRunResult> => ({ ok: false, content: null, failure, reason: 'boom' }) }
}
function deps(runner: DecideRunner): RecommendDeps {
  return { recommendRunner: runner, assembleOptions: { retriever: allRetriever() } }
}
const runnerNeverCalled: DecideRunner = {
  run: async (): Promise<DecideRunResult> => { throw new Error('recommend runner should not be called') },
}

function seedResource(pid: number, title: string): Resource {
  return createResource(pid, { title, kind: 'dashboard', source: 'datadog', service: 'checkout', env: 'prod', aliases: [] })
}

describe('recommendResources', () => {
  it('says the registry is empty (not "nothing relevant") when no sources are saved', async () => {
    const pid = seedProject()
    const res = await recommendResources(pid, 'what should I monitor?', deps(runnerNeverCalled))
    expect(res.items).toEqual([])
    expect(res.summary).toMatch(/No sources saved/i)
    expect(res.failureClass).toBeNull()
  })

  it('returns ranked cited items with app-generated why', async () => {
    const pid = seedProject()
    const r1 = seedResource(pid, 'Checkout error rate')
    const res = await recommendResources(pid, 'rollout monitoring', deps(runnerReturning('{"ids":["c1"]}')))
    expect(res.failureClass).toBeNull()
    expect(res.items).toHaveLength(1)
    expect(res.items[0]?.citation.resourceId).toBe(r1.id)
    expect(res.items[0]?.why).toContain('dashboard')
    expect(res.summary).toMatch(/may be relevant/i)
  })

  it('says it did not find a relevant source when the model selects none', async () => {
    const pid = seedProject()
    seedResource(pid, 'Checkout error rate')
    const res = await recommendResources(pid, 'unrelated', deps(runnerReturning('{"ids":[]}')))
    expect(res.items).toEqual([])
    expect(res.summary).toMatch(/didn’t find|didn't find/i)
    expect(res.failureClass).toBeNull()
  })

  it('reports a failure (not "nothing relevant") when the ranking runner fails', async () => {
    const pid = seedProject()
    seedResource(pid, 'Checkout error rate')
    const res = await recommendResources(pid, 'rollout', deps(runnerFailing('timeout')))
    expect(res.items).toEqual([])
    expect(res.failureClass).toBe('timeout')
    expect(res.summary).toMatch(/couldn’t rank|couldn't rank/i)
  })

  it('fails closed to model_bad_output on an out-of-set id', async () => {
    const pid = seedProject()
    seedResource(pid, 'Checkout error rate')
    const res = await recommendResources(pid, 'rollout', deps(runnerReturning('{"ids":["c9"]}')))
    expect(res.items).toEqual([])
    expect(res.failureClass).toBe('model_bad_output')
  })

  it('does not write to the registry (read-only: no lazy project card)', async () => {
    const pid = seedProject()
    seedResource(pid, 'Checkout error rate')
    const before = (db.query('SELECT count(*) AS c FROM project_cards').get() as { c: number }).c
    await recommendResources(pid, 'rollout', deps(runnerReturning('{"ids":["c1"]}')))
    const after = (db.query('SELECT count(*) AS c FROM project_cards').get() as { c: number }).c
    expect(after).toBe(before)
    // Specifically, no card row was lazily created for this project.
    expect((db.query('SELECT count(*) AS c FROM project_cards WHERE project_id = ?').get(pid) as { c: number }).c).toBe(0)
  })
})
