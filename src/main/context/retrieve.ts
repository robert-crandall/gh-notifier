import type { Resource } from '../../shared/ipc-channels'

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
  retrieve(question: string, corpus: Resource[], limit: number): ScoredCandidate[]
}

// ── Tokenization ──────────────────────────────────────────────────────────────

// Small, boring stopword set. Deliberately minimal so we don't drop meaningful
// tokens; the resolver's questions are short and domain-heavy.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'in', 'on', 'for',
  'and', 'or', 'my', 'our', 'me', 'i', 'how', 'whats', 'what', 'show', 'get', 'find',
  'right', 'now', 'currently', 'please', 'about', 'this', 'that', 'it', 'do', 'does',
  'with', 'at', 'by', 'from', 'looking', 'look', 'check', 'wheres', 'where',
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

/** Precompute a resource's tokenized fields. Pure; exported for tests. */
export function resourceTokens(resource: Resource): FieldTokens {
  const tagValues = Object.values(resource.tags)
  const structValues = new Set<string>(
    [resource.service, resource.env, ...tagValues]
      .map((v) => v.toLowerCase().trim())
      .filter((v) => v.length > 0)
  )
  return {
    title: tokenize(resource.title),
    aliases: resource.aliases.flatMap(tokenize),
    service: tokenize(resource.service),
    env: tokenize(resource.env),
    tags: tagValues.flatMap(tokenize),
    description: tokenize(resource.description),
    source: tokenize(resource.source),
    structValues,
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

  // Structured exact-match dominance: a question token that IS a structured
  // value (service/env/tag) decisively boosts this record over near siblings.
  for (const qt of questionTokens) {
    if (ft.structValues.has(qt)) score += EXACT_STRUCT_BONUS
  }

  return score
}

// ── The lexical retriever ─────────────────────────────────────────────────────

export const lexicalRetriever: Retriever = {
  retrieve(question: string, corpus: Resource[], limit: number): ScoredCandidate[] {
    const questionTokens = tokenize(question)
    const scored = corpus
      .map((resource) => ({ resource, score: scoreResource(questionTokens, resource) }))
      .filter((c) => c.score > 0)
    // Descending score; stable tie-break by id so results are deterministic.
    scored.sort((a, b) => b.score - a.score || a.resource.id - b.resource.id)
    return scored.slice(0, Math.max(0, limit))
  },
}
