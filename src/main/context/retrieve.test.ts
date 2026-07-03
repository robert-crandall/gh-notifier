import { describe, it, expect } from 'vitest'
import type { Resource } from '../../shared/ipc-channels'
import { tokenize, editDistance, scoreResource, lexicalRetriever } from './retrieve'

// ── Fixture factory ───────────────────────────────────────────────────────────

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
    provenance: partial.provenance ?? 'manual',
    confidence: partial.confidence ?? 0.5,
    lastUsed: null,
    lastVerified: null,
    failureCount: partial.failureCount ?? 0,
    suspect: partial.suspect ?? false,
    pinnedGroup: null,
    mcpServer: partial.mcpServer ?? null,
    toolName: partial.toolName ?? null,
    toolArgs: partial.toolArgs ?? null,
    externalRef: null,
    validationState: 'unverified',
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

// ── tokenize ──────────────────────────────────────────────────────────────────

describe('tokenize', () => {
  it('lowercases, splits, drops stopwords', () => {
    expect(tokenize('How is the Service Mesh Latency?')).toEqual(['service', 'mesh', 'latency'])
  })

  it('lightly singularizes plurals', () => {
    expect(tokenize('errors')).toEqual(['error'])
    expect(tokenize('latencies')).toEqual(['latency'])
  })

  it('drops contraction fragments left by splitting', () => {
    // "what's" -> what (stopword) + s (fragment); both dropped. "checkout" stays.
    expect(tokenize("what's checkout doing?")).toEqual(['checkout', 'doing'])
    // The trailing "t" fragment of "don't" is dropped (the "don" stem remains).
    expect(tokenize("don't")).toEqual(['don'])
  })

  it('splits on punctuation and symbols', () => {
    // 'to' is a stopword, so it's dropped.
    expect(tokenize('p99:end_to_end.latency')).toEqual(['p99', 'end', 'end', 'latency'])
  })
})

// ── editDistance ──────────────────────────────────────────────────────────────

describe('editDistance', () => {
  it('is zero for equal strings', () => {
    expect(editDistance('authnd', 'authnd')).toBe(0)
  })
  it('counts single substitutions', () => {
    expect(editDistance('authnd', 'authzd')).toBe(1)
  })
  it('handles empty inputs', () => {
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('abc', '')).toBe(3)
  })
})

// ── scoreResource ─────────────────────────────────────────────────────────────

describe('scoreResource', () => {
  it('scores an alias hit higher than a bare description hit', () => {
    const aliased = makeResource({ title: 'X', aliases: ['mesh latency'] })
    const described = makeResource({ title: 'Y', description: 'mesh latency somewhere in text' })
    const q = tokenize('mesh latency')
    expect(scoreResource(q, aliased)).toBeGreaterThan(scoreResource(q, described))
  })

  it('is zero when nothing matches', () => {
    const r = makeResource({ title: 'Kafka consumer lag', service: 'ingest' })
    expect(scoreResource(tokenize('database backups'), r)).toBe(0)
  })
})

// ── retriever: recall + ranking ───────────────────────────────────────────────

describe('lexicalRetriever', () => {
  it('bridges fuzzy language via aliases (top-1)', async () => {
    const corpus = [
      makeResource({ title: 'Service mesh p99 dashboard', service: 'mesh', aliases: ['mesh latency', 'service mesh latency'] }),
      makeResource({ title: 'Kafka consumer lag', service: 'ingest' }),
      makeResource({ title: 'Postgres connections', service: 'db' }),
    ]
    const [top] = await lexicalRetriever.retrieve('how is the service mesh latency?', corpus, 3)
    expect(top.resource.title).toBe('Service mesh p99 dashboard')
  })

  it('disambiguates near-name siblings via structured service match (Gate 0 note #3)', async () => {
    // authnd vs authzd: one letter apart. The exact service match must win.
    const authnd = makeResource({ title: 'Auth service errors', service: 'authnd', aliases: ['auth errors'] })
    const authzd = makeResource({ title: 'Authz service errors', service: 'authzd', aliases: ['authz errors'] })
    const corpus = [authnd, authzd]

    const forAuthzd = await lexicalRetriever.retrieve('errors for authzd', corpus, 2)
    expect(forAuthzd[0].resource.service).toBe('authzd')

    const forAuthnd = await lexicalRetriever.retrieve('errors for authnd', corpus, 2)
    expect(forAuthnd[0].resource.service).toBe('authnd')
  })

  it('tolerates a typo via edit distance without beating an exact sibling', async () => {
    const authnd = makeResource({ title: 'Authn errors', service: 'authnd' })
    const authzd = makeResource({ title: 'Authz errors', service: 'authzd' })
    const corpus = [authnd, authzd]
    // "authznd" is edit distance 1 from authzd's title token but the question also
    // structurally names authzd — exact structured match must dominate.
    const res = await lexicalRetriever.retrieve('authzd errors', corpus, 2)
    expect(res[0].resource.service).toBe('authzd')
  })

  it('returns nothing for a question with no overlap (feeds negative handling)', async () => {
    const corpus = [makeResource({ title: 'Mesh latency', service: 'mesh' })]
    expect(await lexicalRetriever.retrieve('quarterly revenue forecast', corpus, 5)).toEqual([])
  })

  it('respects the limit and is deterministic on ties', async () => {
    const corpus = [
      makeResource({ title: 'latency one', service: 'svc' }),
      makeResource({ title: 'latency two', service: 'svc' }),
      makeResource({ title: 'latency three', service: 'svc' }),
    ]
    const res = await lexicalRetriever.retrieve('latency', corpus, 2)
    expect(res).toHaveLength(2)
    // stable tie-break by id
    expect(res[0].resource.id).toBeLessThan(res[1].resource.id)
  })

  it('does not apply a health penalty (relevance is pure)', () => {
    // A suspect record with the same textual match must score identically to a
    // healthy one — health is applied later, in assemble, not here.
    const healthy = makeResource({ title: 'mesh latency', service: 'mesh', suspect: false, confidence: 0.9 })
    const suspect = makeResource({ title: 'mesh latency', service: 'mesh', suspect: true, confidence: 0.1 })
    const q = tokenize('mesh latency')
    expect(scoreResource(q, healthy)).toBe(scoreResource(q, suspect))
  })
})
