import { describe, it, expect } from 'vitest'
import type { ProjectCard, Resource } from '../../shared/ipc-channels'
import type { ScoredCandidate } from './retrieve'
import { assemble, capCandidates } from './assemble'

let nextId = 1
function makeResource(partial: Partial<Resource> & { title: string }): Resource {
  return {
    id: nextId++,
    projectId: 1,
    title: partial.title,
    kind: partial.kind ?? 'dashboard',
    source: partial.source ?? 'generic',
    service: partial.service ?? '',
    env: partial.env ?? '',
    tags: partial.tags ?? {},
    url: partial.url ?? null,
    description: partial.description ?? '',
    aliases: partial.aliases ?? [],
    provenance: 'manual',
    confidence: partial.confidence ?? 0.5,
    lastUsed: null,
    lastVerified: null,
    failureCount: 0,
    suspect: partial.suspect ?? false,
    pinnedGroup: null,
    mcpServer: null,
    toolName: null,
    toolArgs: null,
    externalRef: null,
    validationState: 'unverified',
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const emptyCard: ProjectCard = {
  projectId: 1,
  purpose: '',
  repos: [],
  services: [],
  activeGoal: '',
  glossary: {},
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function cand(resource: Resource, score: number): ScoredCandidate {
  return { resource, score }
}

// ── capCandidates ─────────────────────────────────────────────────────────────

describe('capCandidates', () => {
  it('caps to the limit, best-first', () => {
    const pool = [
      cand(makeResource({ title: 'a' }), 10),
      cand(makeResource({ title: 'b' }), 8),
      cand(makeResource({ title: 'c' }), 6),
    ]
    const capped = capCandidates(pool, 2, 2)
    expect(capped).toHaveLength(2)
    expect(capped[0].score).toBe(10)
    expect(capped[1].score).toBe(8)
  })

  it('preserves the strongest suspect match (does not evict it)', () => {
    const suspectTop = makeResource({ title: 'suspect-top', suspect: true })
    const healthy = makeResource({ title: 'healthy', suspect: false })
    const pool = [cand(suspectTop, 20), cand(healthy, 5)]
    const capped = capCandidates(pool, 2, 2)
    // Both fit; the strong suspect match stays and is ranked first.
    expect(capped.map((c) => c.resource.title)).toContain('suspect-top')
    expect(capped[0].resource.title).toBe('suspect-top')
  })

  it('guarantees a healthy alternative a slot instead of all-suspect crowding', () => {
    // Top-2 by relevance are both suspect; a healthy one sits just below the cut.
    const suspect1 = makeResource({ title: 's1', suspect: true })
    const suspect2 = makeResource({ title: 's2', suspect: true })
    const healthy = makeResource({ title: 'h', suspect: false })
    const pool = [cand(suspect1, 10), cand(suspect2, 9), cand(healthy, 8)]

    // limit 2, reserve 1 healthy: the weakest suspect (s2) is swapped for healthy.
    const capped = capCandidates(pool, 2, 1)
    const titles = capped.map((c) => c.resource.title)
    expect(titles).toContain('s1') // strongest suspect preserved
    expect(titles).toContain('h') // healthy alternative guaranteed a slot
    expect(titles).not.toContain('s2') // weakest suspect swapped out
  })

  it('does not swap when there are no healthy alternatives below the cut', () => {
    const s1 = makeResource({ title: 's1', suspect: true })
    const s2 = makeResource({ title: 's2', suspect: true })
    const s3 = makeResource({ title: 's3', suspect: true })
    const pool = [cand(s1, 10), cand(s2, 9), cand(s3, 8)]
    const capped = capCandidates(pool, 2, 2)
    expect(capped.map((c) => c.resource.title)).toEqual(['s1', 's2'])
  })
})

// ── assemble ──────────────────────────────────────────────────────────────────

describe('assemble', () => {
  it('always returns the card plus a capped candidate set', async () => {
    const corpus = [
      makeResource({ title: 'mesh latency', service: 'mesh', aliases: ['service mesh latency'] }),
      makeResource({ title: 'kafka lag', service: 'ingest' }),
    ]
    const ctx = await assemble('how is mesh latency?', emptyCard, corpus, { limit: 5 })
    expect(ctx.card).toBe(emptyCard)
    expect(ctx.candidates.length).toBeGreaterThanOrEqual(1)
    expect(ctx.candidates[0].resource.title).toBe('mesh latency')
    expect(ctx.candidates[0].healthy).toBe(true)
  })

  it('never exceeds the hard cap even with a large corpus', async () => {
    const corpus = Array.from({ length: 30 }, (_, i) =>
      makeResource({ title: `latency dashboard ${i}`, service: 'svc' })
    )
    const ctx = await assemble('latency', emptyCard, corpus, { limit: 5, poolSize: 10 })
    expect(ctx.candidates.length).toBeLessThanOrEqual(5)
  })

  it('marks suspect candidates as not healthy', async () => {
    const corpus = [makeResource({ title: 'mesh latency', service: 'mesh', suspect: true })]
    const ctx = await assemble('mesh latency', emptyCard, corpus, {})
    expect(ctx.candidates[0].healthy).toBe(false)
  })

  it('returns no candidates for an unmatched question (feeds negative handling)', async () => {
    const corpus = [makeResource({ title: 'mesh latency', service: 'mesh' })]
    const ctx = await assemble('quarterly revenue', emptyCard, corpus, {})
    expect(ctx.candidates).toEqual([])
  })
})
