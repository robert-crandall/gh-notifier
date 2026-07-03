import type { Resource } from '../../shared/ipc-channels'
import type { Embedder } from './embed'

/**
 * Two-stage resolver, stage one: retrieval. This produces a *pure relevance*
 * ranking of candidate resources for a fuzzy question. It never decides
 * confident/clarify/none (that is the LLM's job, stage two) and it applies NO
 * health penalty (relevance is computed before health so a broken-but-relevant
 * record still surfaces for repair — see assemble.ts).
 *
 * The default `lexicalRetriever` is deterministic and fully offline: token
 * overlap across weighted fields + structured service/env/tag boosts + edit
 * distance for typo/near-name tolerance. Gate 0's load-bearing finding is the
 * two-stage *shape*; the retrieval mechanism is swappable behind this interface,
 * so an embedding-backed retriever can drop in later without touching the
 * decision stage.
 */

export interface ScoredCandidate {
  resource: Resource
  /** Pure relevance score, >= 0. Higher is more relevant. No health penalty applied. */
  score: number
}

export interface Retriever {
  /** Returns up to `limit` candidates ranked by descending relevance. Ties broken by id (stable). */
  retrieve(question: string, corpus: Resource[], limit: number): Promise<ScoredCandidate[]>
}

// ── Tokenization ──────────────────────────────────────────────────────────────

// Small, boring stopword set. Deliberately minimal so we don't drop meaningful
// tokens; the resolver's questions are short and domain-heavy.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'in', 'on', 'for',
  'and', 'or', 'my', 'our', 'me', 'i', 'how', 'whats', 'what', 'show', 'get', 'find',
  'right', 'now', 'currently', 'please', 'about', 'this', 'that', 'it', 'do', 'does',
  'with', 'at', 'by', 'from', 'looking', 'look', 'check', 'wheres', 'where',
  // Contraction fragments left behind after splitting (what's -> what + s, don't -> don + t).
  's', 't', 're', 've', 'll', 'm', 'd',
])

/** Lowercases, splits on non-alphanumerics, drops stopwords, light singularization. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
    .map(singularize)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
}

/** Very light stemming: strip a trailing plural 's' (latency/latencies handled loosely). */
function singularize(token: string): string {
  if (token.length > 3 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 3 && token.endsWith('es') && !token.endsWith('ses')) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

// ── Edit distance (typo / near-name tolerance) ────────────────────────────────

/** Levenshtein distance, capped implicitly by input length. Pure. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let curr = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

// ── Scoring ───────────────────────────────────────────────────────────────────

// Field weights. Aliases + structured fields (service/env/tags) carry the most
// signal: aliases are the fuzzy-language bridge, and structured fields are what
// disambiguate near-name siblings (Gate 0 note #3) where text alone confuses
// authnd vs authzd.
const WEIGHTS = {
  title: 3,
  alias: 4,
  service: 5,
  env: 3,
  tag: 3,
  description: 1,
  source: 1,
} as const

/**
 * Structured exact-match dominance: when a question token exactly equals a
 * service/env/tag value, that record is decisively boosted so an exact sibling
 * match always outranks a near (edit-distance) sibling. This is the structured
 * disambiguation from Gate 0 note #3.
 */
const EXACT_STRUCT_BONUS = 6

/** Partial credit for a near (edit distance 1) token match — typo tolerance only. */
const NEAR_MATCH_WEIGHT = 0.5

interface FieldTokens {
  title: string[]
  aliases: string[]
  service: string[]
  env: string[]
  tags: string[]
  description: string[]
  source: string[]
  /** Exact structured values (unsplit) for dominance matching. */
  structValues: Set<string>
}

/** The lowercased structured values (service/env/tag) for exact-match matching. Cheap. */
export function resourceStructValues(resource: Resource): Set<string> {
  return new Set<string>(
    [resource.service, resource.env, ...Object.values(resource.tags)]
      .map((v) => v.toLowerCase().trim())
      .filter((v) => v.length > 0)
  )
}

/** Precompute a resource's tokenized fields. Pure; exported for tests. */
export function resourceTokens(resource: Resource): FieldTokens {
  const tagValues = Object.values(resource.tags)
  return {
    title: tokenize(resource.title),
    aliases: resource.aliases.flatMap(tokenize),
    service: tokenize(resource.service),
    env: tokenize(resource.env),
    tags: tagValues.flatMap(tokenize),
    description: tokenize(resource.description),
    source: tokenize(resource.source),
    structValues: resourceStructValues(resource),
  }
}

/** Counts how many question tokens hit a field's token set (exact + near). */
function fieldHits(questionTokens: string[], fieldTokens: string[]): number {
  if (fieldTokens.length === 0) return 0
  const fieldSet = new Set(fieldTokens)
  let score = 0
  for (const qt of questionTokens) {
    if (fieldSet.has(qt)) {
      score += 1
      continue
    }
    // Near match only for reasonably long tokens (avoid matching short noise).
    if (qt.length >= 4) {
      for (const ft of fieldSet) {
        if (Math.abs(ft.length - qt.length) <= 1 && editDistance(qt, ft) === 1) {
          score += NEAR_MATCH_WEIGHT
          break
        }
      }
    }
  }
  return score
}

/** Adds the exact-match bonus for question tokens that hit a precomputed struct-value set. */
function bonusFromStructValues(questionTokens: string[], structValues: Set<string>): number {
  let bonus = 0
  for (const qt of questionTokens) {
    if (structValues.has(qt)) bonus += EXACT_STRUCT_BONUS
  }
  return bonus
}

/**
 * Structured exact-match bonus for a resource: a question token that IS one of
 * the resource's structured values (service/env/tag) decisively boosts it. This
 * is the disambiguation from Gate 0 note #3 (authnd vs authzd) and is shared by
 * both the lexical and embedding retrievers so near-name siblings never confuse
 * the semantic layer either. Pure.
 */
export function structuredMatchBonus(questionTokens: string[], resource: Resource): number {
  // Only needs the structured values — avoid the full field tokenization, which
  // matters in the embedding retriever's per-resource-per-query hot path.
  return bonusFromStructValues(questionTokens, resourceStructValues(resource))
}

/** Pure relevance score of a resource for a set of question tokens. No health penalty. */
export function scoreResource(questionTokens: string[], resource: Resource): number {
  if (questionTokens.length === 0) return 0
  const ft = resourceTokens(resource)

  let score =
    fieldHits(questionTokens, ft.title) * WEIGHTS.title +
    fieldHits(questionTokens, ft.aliases) * WEIGHTS.alias +
    fieldHits(questionTokens, ft.service) * WEIGHTS.service +
    fieldHits(questionTokens, ft.env) * WEIGHTS.env +
    fieldHits(questionTokens, ft.tags) * WEIGHTS.tag +
    fieldHits(questionTokens, ft.description) * WEIGHTS.description +
    fieldHits(questionTokens, ft.source) * WEIGHTS.source

  // Structured exact-match dominance, reusing the already-computed struct values.
  score += bonusFromStructValues(questionTokens, ft.structValues)

  return score
}

/** Synchronous lexical ranking (shared internals; the async retriever wraps this). */
export function rankLexical(question: string, corpus: Resource[], limit: number): ScoredCandidate[] {
  const questionTokens = tokenize(question)
  const scored = corpus
    .map((resource) => ({ resource, score: scoreResource(questionTokens, resource) }))
    .filter((c) => c.score > 0)
  // Descending score; stable tie-break by id so results are deterministic.
  scored.sort((a, b) => b.score - a.score || a.resource.id - b.resource.id)
  return scored.slice(0, Math.max(0, limit))
}

// ── The lexical retriever ─────────────────────────────────────────────────────

export const lexicalRetriever: Retriever = {
  retrieve(question: string, corpus: Resource[], limit: number): Promise<ScoredCandidate[]> {
    return Promise.resolve(rankLexical(question, corpus, limit))
  },
}

// ── Embedding retriever (semantic recall for lexically-disjoint phrasing) ──────

/** The text embedded per resource: everything a question might semantically match. */
export function resourceDocument(resource: Resource): string {
  const tagValues = Object.values(resource.tags).join(' ')
  return [resource.title, resource.aliases.join(' '), resource.description, resource.service, resource.env, tagValues]
    .filter((p) => p.trim().length > 0)
    .join('. ')
}

function dot(a: number[], b: number[]): number {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

/**
 * Cosine floor: drop only genuine noise so weak-but-real matches still reach the
 * decider. It must stay low — the two-stage design relies on the LLM (not this
 * floor) to reject candidates and answer "none". Set from the adversarial eval:
 * a correct-but-weak match (authnd) scored ~0.16, so a 0.2 floor wrongly
 * filtered it. The LLM rejects genuine negatives (verified in the live eval).
 */
const EMBED_MIN_SCORE = 0.1

/**
 * How much a single structured exact-match nudges the (cosine-based) score.
 * Cosine is roughly [-1, 1]; this keeps embeddings primary while letting an
 * exact service/env/tag match break near-name-sibling ties (authnd vs authzd),
 * which pure embeddings alone confuse (Gate 0 note #3).
 */
const EMBED_STRUCT_BONUS = 0.15

/**
 * Creates a hybrid embedding retriever: semantic cosine similarity + the
 * structured exact-match bonus. Corpus embeddings are cached in-memory keyed by
 * the embedded document text, so only new/changed content is re-embedded.
 */
export function createEmbeddingRetriever(embedder: Embedder): Retriever {
  // Cache keyed by the embedded DOCUMENT text, so health/usage bumps (which move
  // updatedAt but not content) don't force re-embedding, and identical content
  // dedups. Bounded so it can't grow without limit.
  const cache = new Map<string, number[]>()
  const MAX_CACHE = 5000

  async function embedCorpus(corpus: Resource[]): Promise<Map<number, number[]>> {
    const docs = corpus.map((r) => resourceDocument(r))
    const missingIdx: number[] = []
    docs.forEach((doc, i) => {
      if (!cache.has(doc)) missingIdx.push(i)
    })
    if (missingIdx.length > 0) {
      const vecs = await embedder.embed(missingIdx.map((i) => docs[i]))
      // Bound the cache. If this batch would overflow, drop the OLD entries first
      // (never mid-batch — that would evict vectors just computed for this corpus
      // and leave current resources with no vector, wrongly filtering them out).
      if (cache.size + missingIdx.length > MAX_CACHE) cache.clear()
      missingIdx.forEach((i, j) => cache.set(docs[i], vecs[j]))
    }
    const byId = new Map<number, number[]>()
    corpus.forEach((r, i) => {
      const v = cache.get(docs[i])
      if (v) byId.set(r.id, v)
    })
    return byId
  }

  return {
    async retrieve(question: string, corpus: Resource[], limit: number): Promise<ScoredCandidate[]> {
      if (corpus.length === 0) return []
      const [queryVec] = await embedder.embed([question])
      const corpusVecs = await embedCorpus(corpus)
      const questionTokens = tokenize(question)

      const scored = corpus
        .map((resource) => {
          const vec = corpusVecs.get(resource.id)
          if (vec === undefined) return { resource, score: 0 }
          const cosine = dot(queryVec, vec)
          const bonus = structuredMatchBonus(questionTokens, resource) > 0 ? EMBED_STRUCT_BONUS : 0
          return { resource, score: cosine + bonus }
        })
        // Drop only genuine noise; the LLM decides "none" over what survives.
        .filter((c) => c.score > EMBED_MIN_SCORE)

      scored.sort((a, b) => b.score - a.score || a.resource.id - b.resource.id)
      return scored.slice(0, Math.max(0, limit))
    },
  }
}

/**
 * The production retriever: the hybrid embedding retriever (semantic cosine +
 * structured tie-break) with a transparent lexical fallback if the embedding
 * model can't load or an embed fails (offline, missing runtime). Pure lexical
 * ranking is deliberately NOT fused in — on lexically-disjoint questions its
 * coincidental token matches add noise that drags the right semantic result
 * down (measured: fusion scored lower on the adversarial eval than embeddings
 * alone). The structured bonus already recovers exact service/env/tag matches.
 */
export function createDefaultRetriever(embedder: Embedder): Retriever {
  const embedding = createEmbeddingRetriever(embedder)
  return {
    async retrieve(question: string, corpus: Resource[], limit: number): Promise<ScoredCandidate[]> {
      try {
        return await embedding.retrieve(question, corpus, limit)
      } catch (err) {
        console.error('[retrieve] embedding retriever failed; falling back to lexical:', err)
        return rankLexical(question, corpus, limit)
      }
    },
  }
}
