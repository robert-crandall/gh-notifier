import { describe, it, expect } from 'vitest'
import { loadCorpus, loadAdversarialQuestions, toResourceFixtures, runRetrievalEval } from './harness'
import { tokenize, lexicalRetriever, scoreResource, rankLexical } from '../retrieve'
import type { Resource } from '../../../shared/ipc-channels'

/**
 * Honesty guard: makes it structurally impossible to silently regress to a
 * lexically-aligned (rigged) eval like the one that shipped in #76.
 *
 * The AUTHORITATIVE check runs the REAL runtime lexical scorer: for every
 * `semantic`-bucket question, `scoreResource(question, target)` must be exactly 0
 * and the target must NOT appear in `rankLexical`. This is stronger than a
 * hand-rolled token-overlap check — it accounts for every field the runtime
 * actually scores (title/aliases/description/service/env/tags AND `source`) plus
 * any near-match/edit-distance scoring, so a question can't sneak through by
 * overlapping a field the guard forgot to model.
 *
 * A token-overlap diagnostic (over the same full field set, including `source`)
 * is kept only to make failures legible.
 *
 * `structured-disambiguation` questions intentionally name the service, so they
 * are exempt.
 */

/** Union of tokens across ALL of a record's lexically-scored fields (incl. source). */
function targetTokens(record: Resource): Set<string> {
  return new Set<string>([
    ...tokenize(record.title),
    ...record.aliases.flatMap(tokenize),
    ...tokenize(record.description),
    ...tokenize(record.service),
    ...tokenize(record.env),
    ...tokenize(record.source),
    ...Object.values(record.tags).flatMap(tokenize),
  ])
}

describe('adversarial eval honesty guard', () => {
  const corpus = loadCorpus()
  const { resources, stringIdByNumericId } = toResourceFixtures(corpus)
  const numericIdByStringId = new Map([...stringIdByNumericId].map(([n, s]) => [s, n]))
  const byStringId = new Map(resources.map((r) => [stringIdByNumericId.get(r.id) ?? '', r]))
  const questions = loadAdversarialQuestions()
  const semantic = questions.filter((q) => q.bucket === 'semantic')

  it('has a real semantic bucket and every adversarial question is bucketed', () => {
    expect(semantic.length).toBeGreaterThanOrEqual(10)
    expect(questions.every((q) => q.bucket === 'semantic' || q.bucket === 'structured-disambiguation')).toBe(true)
  })

  it('the REAL lexical scorer cannot reach any semantic target (score 0, not ranked)', () => {
    const violations: string[] = []
    for (const q of semantic) {
      const target = q.expectedId ? byStringId.get(q.expectedId) : undefined
      expect(target, `unknown expectedId ${q.expectedId}`).toBeDefined()
      if (!target) continue
      const score = scoreResource(tokenize(q.q), target)
      const rankedIds = rankLexical(q.q, resources, resources.length).map(
        (c) => stringIdByNumericId.get(c.resource.id) ?? ''
      )
      const reachable = score > 0 || rankedIds.includes(q.expectedId ?? '')
      if (reachable) {
        const forbidden = targetTokens(target)
        const overlap = tokenize(q.q).filter((t) => forbidden.has(t))
        violations.push(`"${q.q}" -> ${q.expectedId}: score=${score.toFixed(3)} overlap=[${overlap.join(', ')}]`)
      }
    }
    if (violations.length > 0) console.error('lexically-reachable semantic questions:\n' + violations.join('\n'))
    expect(violations).toEqual([])
  })

  it('lexical retrieval recall on the semantic bucket is ~0 (proves it needs embeddings)', async () => {
    const report = await runRetrievalEval(lexicalRetriever, 3, semantic)
    expect(report.topKRecall).toBeLessThanOrEqual(0.1)
  })

  it('every adversarial question id resolves to a real corpus record', () => {
    for (const q of questions) {
      if (q.expectedId) expect(numericIdByStringId.has(q.expectedId), `unknown id ${q.expectedId}`).toBe(true)
    }
  })
})
