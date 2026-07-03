import { describe, it, expect, beforeAll } from 'vitest'
import { runRetrievalEval, loadCorpus, loadQuestions, loadAdversarialQuestions, toResourceFixtures } from './harness'
import { lexicalRetriever, type ScoredCandidate } from '../retrieve'
import type { RetrievalReport } from './harness'

/**
 * Offline retrieval gates (deterministic, no network).
 *
 * The ALIGNED set shares vocabulary with the records (aliases bridge the fuzzy
 * language), and the lexical retriever clears Gate 0's bar on it. The ADVERSARIAL
 * set is deliberately lexically DISJOINT from the records — it exists to keep us
 * honest: lexical retrieval does NOT clear the bar there, which is exactly why
 * the resolver ships the embedding retriever in production (proven separately in
 * the network-dependent retriever-eval, since a local model can't run in CI).
 */

describe('resolver retrieval eval (offline, synthetic)', () => {
  let aligned: RetrievalReport
  let adversarial: RetrievalReport

  beforeAll(async () => {
    aligned = await runRetrievalEval(lexicalRetriever)
    adversarial = await runRetrievalEval(lexicalRetriever, 3, loadAdversarialQuestions())
  })

  it('has a corpus and question set of the expected shape', () => {
    expect(loadCorpus().length).toBeGreaterThanOrEqual(20)
    expect(loadQuestions().length).toBeGreaterThanOrEqual(21)
    expect(loadAdversarialQuestions().length).toBeGreaterThanOrEqual(10)
    expect(aligned.fuzzyTotal).toBeGreaterThanOrEqual(18)
  })

  it('lexical clears 100% top-3 recall on the ALIGNED set (Gate 0 bar)', () => {
    if (aligned.topKRecall < 1) console.error('aligned top-3 misses:', JSON.stringify(aligned.misses, null, 2))
    expect(aligned.topKRecall).toBe(1)
  })

  it('lexical clears >= 80% top-1 recall on the ALIGNED set', () => {
    expect(aligned.top1Recall).toBeGreaterThanOrEqual(0.8)
  })

  it('surfaces >= 2 plausible candidates for every ambiguous question', () => {
    expect(aligned.ambiguousSurfaced).toBe(aligned.ambiguousTotal)
  })

  it('lexical does NOT clear the bar on the ADVERSARIAL set (why we ship embeddings)', () => {
    // The adversarial questions are genuinely lexically disjoint: lexical
    // retrieval falls well short of Gate 0's 100% top-3 bar. This assertion
    // guards against the eval quietly becoming lexically-aligned (a false pass).
    expect(adversarial.topKRecall).toBeLessThan(0.9)
  })
})

describe('Retriever interface is async', () => {
  it('lexicalRetriever.retrieve returns a Promise', async () => {
    const { resources } = toResourceFixtures(loadCorpus())
    const result = lexicalRetriever.retrieve('checkout latency', resources, 3)
    expect(result).toBeInstanceOf(Promise)
    const candidates: ScoredCandidate[] = await result
    expect(Array.isArray(candidates)).toBe(true)
  })
})
