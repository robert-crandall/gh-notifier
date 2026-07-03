import type { Resource, RetrievalMode } from '../../shared/ipc-channels'
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

/** The outcome of a retrieval: the ranked candidates + which path produced them. */
export interface RetrievalOutcome {
  candidates: ScoredCandidate[]
  mode: RetrievalMode
}

export interface Retriever {
  /** Returns up to `limit` candidates (best-first, ties by id) + the retrieval mode. */
  retrieve(question: string, corpus: Resource[], limit: number): Promise<RetrievalOutcome>
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

/** True for a lowercased ASCII alphanumeric char (used for word boundaries). */
function isAlnum(ch: string): boolean {
  if (ch.length === 0) return false
  const c = ch.charCodeAt(0)
  return (c >= 48 && c <= 57) || (c >= 97 && c <= 122)
}

/** Whole-token containment (alnum boundaries) without RegExp compilation. */
function containsToken(haystack: string, token: string): boolean {
  let from = 0
  for (;;) {
    const idx = haystack.indexOf(token, from)
    if (idx === -1) return false
    const before = idx === 0 ? '' : haystack[idx - 1]
    const after = idx + token.length >= haystack.length ? '' : haystack[idx + token.length]
    if (!isAlnum(before) && !isAlnum(after)) return true
    from = idx + 1
  }
}

/**
 * Boolean structured hit-check (Gate 0 note #3: authnd vs authzd). True when a
 * structured value (service/env/tag) appears as a whole token in the raw
 * question — matched against the raw string, NOT tokenize(), so hyphenated
 * values like "orders-db" or "us-east" are detected when typed exactly.
 * Decoupled from the lexical weight constant so the embedding retriever's
 * tie-break is unaffected if EXACT_STRUCT_BONUS is ever re-tuned. Pure.
 */
export function hasStructuredMatch(question: string, resource: Resource): boolean {
  const q = question.toLowerCase()
  for (const value of resourceStructValues(resource)) {
    if (containsToken(q, value)) return true
  }
  return false
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
  retrieve(question: string, corpus: Resource[], limit: number): Promise<RetrievalOutcome> {
    return Promise.resolve({ candidates: rankLexical(question, corpus, limit), mode: 'lexical' })
  },
}

// ── Embedding retriever (semantic recall for lexically-disjoint phrasing) ──────

/**
 * Bumped whenever `buildEmbedText`/`buildQueryText` change shape. Golden vectors
 * are keyed to this: the golden-drift test fails CI if the committed version
 * doesn't match, forcing a `--update-golden` regen (which re-runs the real model
 * and refuses to bless a regression).
 */
export const EMBED_TEXT_VERSION = 'v1'

/**
 * The single shared embed-text path. Runtime retrieval, the eval harness, and
 * golden-vector generation ALL build the embedded string here so they can never
 * drift (a golden vector is only valid for the exact string this produces).
 */
export function buildEmbedText(resource: Resource): string {
  // Sort tags by key so the embedded text (and thus the cache key) is stable
  // regardless of JSON round-trip key ordering.
  const tagValues = Object.entries(resource.tags)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)
    .join(' ')
  return [resource.title, resource.aliases.join(' '), resource.description, resource.service, resource.env, tagValues]
    .filter((p) => p.trim().length > 0)
    .join('. ')
}

/** The text embedded for a query. Centralized so golden + runtime match exactly. */
export function buildQueryText(question: string): string {
  return question
}

function dot(a: number[], b: number[]): number {
  // Fail fast on a dimension mismatch (model change / corrupted cache / partial
  // output) rather than silently scoring on a truncated prefix. The default
  // retriever catches this and falls back to lexical.
  if (a.length !== b.length) {
    throw new Error(`embedding dimension mismatch: ${a.length} vs ${b.length}`)
  }
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/**
 * Minimum RAW COSINE (semantic similarity, BEFORE the structured boost) for a
 * candidate to survive. Applying the floor to raw cosine — not the combined
 * score — makes the negative gate deterministic and app-owned: a common tag
 * boost (e.g. `prod`/`auth`) can't lift a semantically-unrelated record past it.
 * The structured boost then only re-orders records that already cleared the
 * semantic gate. Kept low (a correct-but-weak match scored ~0.16 cosine) — the
 * LLM decides "none" over what survives.
 */
const EMBED_MIN_COSINE = 0.1

/** Exposed so the golden eval can assert each target clears the raw-cosine floor. */
export const EMBED_MIN_COSINE_FLOOR = EMBED_MIN_COSINE

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
    const docs = corpus.map((r) => buildEmbedText(r))
    const missingIdx: number[] = []
    docs.forEach((doc, i) => {
      if (!cache.has(doc)) missingIdx.push(i)
    })
    // Vectors for docs embedded this call but not persisted (oversized batch).
    const fresh = new Map<string, number[]>()
    if (missingIdx.length > 0) {
      const vecs = await embedder.embed(missingIdx.map((i) => docs[i]))
      // Fail fast if the embedder didn't return exactly one vector per document —
      // otherwise a short/misordered result would silently cache invalid vectors
      // (score 0 -> wrongly filtered). createDefaultRetriever falls back to lexical.
      if (vecs.length !== missingIdx.length) {
        throw new Error(`embedder returned ${vecs.length} vectors for ${missingIdx.length} documents`)
      }
      // Only persist to the bounded cache when the batch itself fits; a batch
      // larger than MAX_CACHE is used transiently for this query and not cached,
      // so the persistent cache stays strictly bounded. Clear old entries first
      // (never mid-batch) when a fitting batch would overflow.
      const persist = missingIdx.length <= MAX_CACHE
      if (persist && cache.size + missingIdx.length > MAX_CACHE) cache.clear()
      missingIdx.forEach((i, j) => {
        if (persist) cache.set(docs[i], vecs[j])
        else fresh.set(docs[i], vecs[j])
      })
    }
    const byId = new Map<number, number[]>()
    corpus.forEach((r, i) => {
      const v = cache.get(docs[i]) ?? fresh.get(docs[i])
      if (v) byId.set(r.id, v)
    })
    return byId
  }

  return {
    async retrieve(question: string, corpus: Resource[], limit: number): Promise<RetrievalOutcome> {
      if (corpus.length === 0 || limit <= 0) return { candidates: [], mode: 'semantic' }
      const queryVecs = await embedder.embed([buildQueryText(question)])
      // Assert exactly one vector for the single-text request so a buggy embedder
      // fails fast (to the lexical fallback) instead of masking a contract break.
      if (queryVecs.length !== 1) {
        throw new Error(`embedder returned ${queryVecs.length} vectors for a single query`)
      }
      const queryVec = queryVecs[0]
      const corpusVecs = await embedCorpus(corpus)

      const scored: ScoredCandidate[] = []
      for (const resource of corpus) {
        const vec = corpusVecs.get(resource.id)
        if (vec === undefined) continue
        const cosine = dot(queryVec, vec)
        // Raw-cosine negative gate BEFORE the structured boost, so a tag match
        // can't rescue a semantically-unrelated record.
        if (cosine < EMBED_MIN_COSINE) continue
        const bonus = hasStructuredMatch(question, resource) ? EMBED_STRUCT_BONUS : 0
        scored.push({ resource, score: cosine + bonus })
      }

      scored.sort((a, b) => b.score - a.score || a.resource.id - b.resource.id)
      return { candidates: scored.slice(0, Math.max(0, limit)), mode: 'semantic' }
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
  let warnedFailure = false
  return {
    async retrieve(question: string, corpus: Resource[], limit: number): Promise<RetrievalOutcome> {
      try {
        return await embedding.retrieve(question, corpus, limit)
      } catch (err) {
        // Log once per retriever instance so a persistently-unavailable model
        // (offline first run / missing runtime) doesn't spam on every resolve.
        if (!warnedFailure) {
          warnedFailure = true
          console.error('[retrieve] embedding retriever failed; falling back to lexical:', err)
        }
        // Report the degraded mode so a fallback answer is observable end-to-end.
        return { candidates: rankLexical(question, corpus, limit), mode: 'lexical-fallback' }
      }
    },
  }
}
