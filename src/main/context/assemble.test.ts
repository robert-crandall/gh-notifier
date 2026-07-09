import { describe, it, expect } from 'vitest'
import type { ProjectCard, Resource } from '../../shared/ipc-channels'
import { assemble } from './assemble'

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
    pinnedGroup: null,
    externalRef: null,
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
  })

  it('never exceeds the hard cap even with a large corpus', async () => {
    const corpus = Array.from({ length: 30 }, (_, i) =>
      makeResource({ title: `latency dashboard ${i}`, service: 'svc' })
    )
    const ctx = await assemble('latency', emptyCard, corpus, { limit: 5, poolSize: 10 })
    expect(ctx.candidates.length).toBeLessThanOrEqual(5)
  })

  it('caps a large retrieved pool to the limit, best-first', async () => {
    const corpus = Array.from({ length: 12 }, (_, i) =>
      makeResource({ title: `latency dashboard ${i}`, service: 'svc' })
    )
    const ctx = await assemble('latency', emptyCard, corpus, { limit: 3, poolSize: 10 })
    expect(ctx.candidates).toHaveLength(3)
    // Scores are non-increasing (best-first).
    expect(ctx.candidates[0].score).toBeGreaterThanOrEqual(ctx.candidates[1].score)
    expect(ctx.candidates[1].score).toBeGreaterThanOrEqual(ctx.candidates[2].score)
  })

  it('returns no candidates for an unmatched question (feeds negative handling)', async () => {
    const corpus = [makeResource({ title: 'mesh latency', service: 'mesh' })]
    const ctx = await assemble('quarterly revenue', emptyCard, corpus, {})
    expect(ctx.candidates).toEqual([])
  })
})
