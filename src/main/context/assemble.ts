import type { ProjectCard, Resource, RetrievalMode } from '../../shared/ipc-channels'
import { lexicalRetriever, type Retriever } from './retrieve'

/**
 * Two-layer context assembler, between stage one (retrieve) and the
 * recommendation ranking: it injects the tiny project card (always) plus a
 * hard-capped set of top candidates (never the whole registry). Relevance is
 * computed by the retriever; this only caps the pool to the injection limit,
 * best-first.
 */

export interface AssembledCandidate {
  resource: Resource
  /** Pure relevance score from the retriever. */
  score: number
}

export interface AssembledContext {
  card: ProjectCard
  /** The capped candidate set handed to the ranking stage, best-first. */
  candidates: AssembledCandidate[]
  /** Which retrieval path produced the candidates. */
  retrievalMode: RetrievalMode
}

export interface AssembleOptions {
  /** How many candidates to retrieve before capping. Default 15. */
  poolSize?: number
  /** Hard cap on candidates injected into the ranking stage. Default 8. */
  limit?: number
  /** Swappable retriever. Default: deterministic lexical. */
  retriever?: Retriever
}

const DEFAULT_POOL_SIZE = 15
// The ranker sees up to this many candidates. Kept generous (not 5) so a
// correct-but-lower-ranked semantic match still reaches the model — the
// adversarial eval had a right answer at rank 7 that a cap of 5 hid.
const DEFAULT_LIMIT = 8

/**
 * Assembles the two-layer context for a question. Pure over its inputs — the DB
 * reads (card + corpus) happen in the caller so this stays testable offline.
 * Async because the retriever may be embedding-backed.
 */
export async function assemble(
  question: string,
  card: ProjectCard,
  corpus: Resource[],
  options: AssembleOptions = {}
): Promise<AssembledContext> {
  const poolSize = options.poolSize ?? DEFAULT_POOL_SIZE
  const limit = options.limit ?? DEFAULT_LIMIT
  const retriever = options.retriever ?? lexicalRetriever

  const pool = await retriever.retrieve(question, corpus, poolSize)
  const capped = pool.candidates.slice(0, Math.max(0, limit))

  return {
    card,
    candidates: capped.map((c) => ({ resource: c.resource, score: c.score })),
    retrievalMode: pool.mode,
  }
}
