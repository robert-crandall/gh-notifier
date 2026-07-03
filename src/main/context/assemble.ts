import type { ProjectCard, Resource } from '../../shared/ipc-channels'
import { lexicalRetriever, type Retriever, type ScoredCandidate } from './retrieve'

/**
 * Two-stage resolver, between stage one (retrieve) and stage two (decide): the
 * two-layer context assembler. It injects the tiny project card (always) plus a
 * hard-capped set of top candidates (never the whole registry).
 *
 * Key invariant (from review): relevance is computed BEFORE any health penalty,
 * and the cap preserves strong matches — including suspect ones, so a
 * broken-but-relevant record still surfaces for repair — while guaranteeing a
 * few healthy alternatives get a slot so suspect records can't crowd out valid
 * lower-ranked ones. Health is an ordering/flagging signal here, never a filter.
 */

export interface AssembledCandidate {
  resource: Resource
  /** Pure relevance score from the retriever. */
  score: number
  /** False when the record is suspect (last source/query failure). */
  healthy: boolean
}

export interface AssembledContext {
  card: ProjectCard
  /** The capped candidate set handed to the decision stage, best-first. */
  candidates: AssembledCandidate[]
}

export interface AssembleOptions {
  /** How many candidates to retrieve before capping. Default 10. */
  poolSize?: number
  /** Hard cap on candidates injected into the decision stage. Default 5. */
  limit?: number
  /** Minimum healthy candidates to guarantee in the final set when available. Default 2. */
  healthyReserve?: number
  /** Swappable retriever. Default: deterministic lexical. */
  retriever?: Retriever
}

const DEFAULT_POOL_SIZE = 15
// The decider sees up to this many candidates. Kept generous (not 5) so a
// correct-but-lower-ranked semantic match still reaches the LLM — the
// adversarial eval had a right answer at rank 7 that a cap of 5 hid.
const DEFAULT_LIMIT = 8
const DEFAULT_HEALTHY_RESERVE = 2

function isHealthy(resource: Resource): boolean {
  return !resource.suspect
}

/**
 * Caps a relevance-sorted pool to `limit`, preserving the strongest matches
 * (including suspect ones) while guaranteeing up to `healthyReserve` healthy
 * candidates a slot. When healthy alternatives exist below the naive cut and the
 * top-k is short on healthy options, the weakest suspect entries in the top-k
 * are swapped out for the strongest healthy ones below it. Pure.
 */
export function capCandidates(
  pool: ScoredCandidate[],
  limit: number,
  healthyReserve: number
): ScoredCandidate[] {
  if (limit <= 0) return []
  const topK = pool.slice(0, limit)

  const healthyInTopK = topK.filter((c) => isHealthy(c.resource)).length
  const needed = Math.min(healthyReserve, limit) - healthyInTopK
  if (needed <= 0) return topK

  const healthyBelow = pool.slice(limit).filter((c) => isHealthy(c.resource))
  if (healthyBelow.length === 0) return topK

  // Swap out the weakest suspect entries (from the bottom of topK) for the
  // strongest healthy candidates below the cut. Strong suspect matches stay.
  const result = [...topK]
  const swaps = Math.min(needed, healthyBelow.length)
  for (let i = 0; i < swaps; i++) {
    // Find the lowest-relevance suspect in result (scan from the end).
    let swapIdx = -1
    for (let j = result.length - 1; j >= 0; j--) {
      if (!isHealthy(result[j].resource)) {
        swapIdx = j
        break
      }
    }
    if (swapIdx === -1) break // nothing suspect left to swap
    result[swapIdx] = healthyBelow[i]
  }

  // Re-sort so the final set is presented best-first (stable by id).
  result.sort((a, b) => b.score - a.score || a.resource.id - b.resource.id)
  return result
}

/**
 * Assembles the two-layer context for a question. Pure over its inputs — the DB
 * reads (card + corpus) happen in the caller (resolve.ts) so this stays testable
 * offline. Async because the retriever may be embedding-backed.
 */
export async function assemble(
  question: string,
  card: ProjectCard,
  corpus: Resource[],
  options: AssembleOptions = {}
): Promise<AssembledContext> {
  const poolSize = options.poolSize ?? DEFAULT_POOL_SIZE
  const limit = options.limit ?? DEFAULT_LIMIT
  const healthyReserve = options.healthyReserve ?? DEFAULT_HEALTHY_RESERVE
  const retriever = options.retriever ?? lexicalRetriever

  const pool = await retriever.retrieve(question, corpus, poolSize)
  const capped = capCandidates(pool, limit, healthyReserve)

  return {
    card,
    candidates: capped.map((c) => ({
      resource: c.resource,
      score: c.score,
      healthy: isHealthy(c.resource),
    })),
  }
}
