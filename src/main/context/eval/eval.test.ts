import { describe, it, expect } from 'vitest'
import { runRetrievalEval, loadCorpus, loadQuestions } from './harness'

/**
 * Offline retrieval-recall gate. Carries Gate 0's rubric for the deterministic
 * half: top-3 recall on fuzzy questions must be perfect on the synthetic corpus,
 * top-1 recall must clear 80%, and ambiguous questions must surface >= 2
 * plausible candidates so the decision stage can clarify. The LLM half
 * (right-source@1, negatives, live pull) is the manual `--live` run.
 */

describe('resolver retrieval eval (offline, synthetic)', () => {
  const report = runRetrievalEval()

  it('has a corpus and question set of the expected shape', () => {
    expect(loadCorpus().length).toBeGreaterThanOrEqual(20)
    expect(loadQuestions().length).toBeGreaterThanOrEqual(21)
    expect(report.fuzzyTotal).toBeGreaterThanOrEqual(18)
  })

  it('clears 100% top-3 recall on fuzzy questions (Gate 0 bar)', () => {
    if (report.top3Recall < 1) {
      // Surface the misses so a regression is diagnosable.
      console.error('top-3 misses:', JSON.stringify(report.misses, null, 2))
    }
    expect(report.top3Recall).toBe(1)
  })

  it('clears >= 80% top-1 recall on fuzzy questions', () => {
    expect(report.top1Recall).toBeGreaterThanOrEqual(0.8)
  })

  it('surfaces >= 2 plausible candidates for every ambiguous question', () => {
    expect(report.ambiguousSurfaced).toBe(report.ambiguousTotal)
  })
})
