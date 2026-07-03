import { describe, it, expect } from 'vitest'
import type { Resource } from '../../shared/ipc-channels'
import type { Embedder } from './embed'
import { createEmbeddingRetriever, createDefaultRetriever, resourceDocument } from './retrieve'

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
    url: null,
    description: partial.description ?? '',
    aliases: partial.aliases ?? [],
    provenance: 'manual',
    confidence: 0.5,
    lastUsed: null,
    lastVerified: null,
    failureCount: 0,
    suspect: false,
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

// A deterministic fake embedder: routes text to a one-hot topic vector so tests
// are offline and stable (no model download). Cosine of matching topic = 1.
function topicEmbedder(): Embedder {
  const vec = (t: string): number[] => {
    if (/login|account|auth/i.test(t)) return [1, 0, 0]
    if (/ship|carrier|label/i.test(t)) return [0, 1, 0]
    return [0, 0, 1]
  }
  return { embed: async (texts) => texts.map(vec) }
}

describe('resourceDocument', () => {
  it('includes title, aliases, description, service, env', () => {
    const doc = resourceDocument(
      makeResource({ title: 'Auth errors', aliases: ['login errors'], description: 'd', service: 'authnd', env: 'prod' })
    )
    expect(doc).toContain('Auth errors')
    expect(doc).toContain('login errors')
    expect(doc).toContain('authnd')
    expect(doc).toContain('prod')
  })
})

describe('createEmbeddingRetriever (hybrid, fake embedder)', () => {
  it('ranks the semantically-closest record first despite zero lexical overlap', async () => {
    const authn = makeResource({ title: 'Authentication service errors', aliases: ['login errors', 'sign in failures'], service: 'authnd' })
    const shipping = makeResource({ title: 'Shipping label delay', aliases: ['carrier handoff'], service: 'shipping' })
    const retriever = createEmbeddingRetriever(topicEmbedder())
    // Query shares NO words with the authn record, but is topically "account/login".
    const res = await retriever.retrieve('why is my account locked?', [authn, shipping], 5)
    expect(res[0].resource.id).toBe(authn.id)
    // The unrelated shipping doc (cosine 0) is filtered out.
    expect(res.map((r) => r.resource.id)).not.toContain(shipping.id)
  })

  it('uses the structured bonus to break a near-sibling tie', async () => {
    // Both are "auth" topic (same cosine); the exact service token decides.
    const authnd = makeResource({ title: 'Authn errors', aliases: ['login errors'], service: 'authnd' })
    const authzd = makeResource({ title: 'Authz errors', aliases: ['login errors'], service: 'authzd' })
    const retriever = createEmbeddingRetriever(topicEmbedder())
    const res = await retriever.retrieve('login errors for authzd', [authnd, authzd], 2)
    expect(res[0].resource.service).toBe('authzd')
  })

  it('detects a hyphenated structured value typed exactly (orders-db)', async () => {
    // tokenize() would split "orders-db" into order/db; the raw-string check must
    // still fire the structured tie-break for the exact hyphenated service.
    const ordersDb = makeResource({ title: 'DB one', aliases: ['login'], service: 'orders-db' })
    const other = makeResource({ title: 'DB two', aliases: ['login'], service: 'billing-db' })
    const retriever = createEmbeddingRetriever(topicEmbedder())
    const res = await retriever.retrieve('login errors on orders-db', [ordersDb, other], 2)
    expect(res[0].resource.service).toBe('orders-db')
  })

  it('returns nothing when nothing is semantically close (feeds honest none)', async () => {
    const authn = makeResource({ title: 'Auth errors', aliases: ['login'], service: 'authnd' })
    const retriever = createEmbeddingRetriever(topicEmbedder())
    // "carrier handoff" is the shipping topic; the only record is auth -> cosine 0.
    const res = await retriever.retrieve('carrier handoff time', [authn], 5)
    expect(res).toEqual([])
  })

  it('re-embeds only changed content (cache keyed by document, not updatedAt)', async () => {
    let embedCalls = 0
    const counting: Embedder = {
      embed: async (texts) => {
        embedCalls++
        return texts.map(() => [1, 0, 0])
      },
    }
    const r = makeResource({ title: 'Auth', service: 'authnd' })
    const retriever = createEmbeddingRetriever(counting)
    await retriever.retrieve('login', [r], 5) // embeds query + corpus
    const afterFirst = embedCalls
    // A health/usage bump moves updatedAt but not the document text -> no re-embed.
    const bumped = { ...r, updatedAt: '2027-02-02T00:00:00.000Z' }
    await retriever.retrieve('login again', [bumped], 5) // corpus cached -> only query embed
    expect(embedCalls).toBe(afterFirst + 1)
  })
})

describe('createDefaultRetriever (embedding with lexical fallback)', () => {
  it('falls back to lexical scoring when the embedder throws', async () => {
    const throwing: Embedder = {
      embed: async () => {
        throw new Error('no model')
      },
    }
    const mesh = makeResource({ title: 'Service mesh latency', service: 'mesh', aliases: ['mesh latency'] })
    const retriever = createDefaultRetriever(throwing)
    // Lexically overlapping query still resolves via the fallback.
    const res = await retriever.retrieve('mesh latency', [mesh], 5)
    expect(res[0]?.resource.id).toBe(mesh.id)
  })
})
