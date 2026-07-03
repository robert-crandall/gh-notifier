import { describe, it, expect } from 'vitest'
import {
  createEmbeddingRetriever,
  buildEmbedText,
  buildQueryText,
  EMBED_MIN_COSINE_FLOOR,
} from '../retrieve'
import { loadCorpus, loadQuestions, loadAdversarialQuestions, toResourceFixtures, runRetrievalEval } from './harness'
import {
  GoldenEmbedder,
  loadGoldenFile,
  enumerateEmbedTexts,
  currentGoldenIdentity,
} from './golden'

/**
 * Hermetic CI gate: drives the REAL hybrid retriever (raw-cosine floor +
 * structured boost) against COMMITTED MiniLM vectors — no model download, no
 * network, fully deterministic. This is what makes the adversarial recall bar a
 * permanent gate rather than a one-off manual measurement.
 *
 * The bar is INDEPENDENT hard constants below, NOT the `metrics` field in the
 * JSON — otherwise a PR could regress the retriever and edit the committed
 * metric to match, and the gate would bless it. The committed `metrics` field is
 * only checked for CONSISTENCY (it must reproduce), so a hand-edit that doesn't
 * match the vectors also fails.
 */

// The honest bar the committed vectors must clear (Gate 0: top-3/recall stays
// high, including on the genuinely zero-overlap semantic questions). These are
// deliberately hard-coded here, not read from the golden JSON.
const EXPECTED_ALIGNED_RECALL_AT3 = 1
const EXPECTED_ADVERSARIAL_RECALL_AT8 = 1

describe('golden-vector hermetic eval', () => {
  const golden = loadGoldenFile()
  const embedder = new GoldenEmbedder(golden.vectors)

  it('matches the current model + embed-text identity (drift signal)', () => {
    const id = currentGoldenIdentity()
    expect(golden.modelId).toBe(id.modelId)
    expect(golden.embedTextVersion).toBe(id.embedTextVersion)
  })

  it('covers exactly the current corpus + questions (no missing, no orphan keys)', () => {
    const needed = enumerateEmbedTexts()
    const committed = new Set(Object.keys(golden.vectors))
    const missing = needed.filter((t) => !committed.has(t))
    expect(missing, `missing golden vectors:\n${missing.join('\n')}`).toEqual([])
    expect(committed.size).toBe(new Set(needed).size)
  })

  it('every committed vector is a finite, L2-normalized 384-dim vector', () => {
    for (const [text, vec] of Object.entries(golden.vectors)) {
      expect(vec.length, text).toBe(384)
      expect(vec.every((x) => Number.isFinite(x)), text).toBe(true)
      // MiniLM output is L2-normalized; 6-decimal rounding keeps the norm ~1.
      const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0))
      expect(norm, `${text} norm`).toBeGreaterThan(0.99)
      expect(norm, `${text} norm`).toBeLessThan(1.01)
    }
  })

  it('REAL hybrid retriever clears the Gate 0 bar (independent constants)', async () => {
    const retriever = createEmbeddingRetriever(embedder)
    const aligned = await runRetrievalEval(retriever, 3, loadQuestions())
    const adversarial = await runRetrievalEval(retriever, 8, loadAdversarialQuestions())

    // Bar = independent constants, so a regressed retriever can't be blessed by
    // editing the committed metric.
    expect(aligned.topKRecall).toBe(EXPECTED_ALIGNED_RECALL_AT3)
    expect(adversarial.topKRecall).toBe(EXPECTED_ADVERSARIAL_RECALL_AT8)

    // And the committed `metrics` field must reproduce (consistency: a hand-edit
    // of the metric that doesn't match the vectors fails here).
    expect(aligned.topKRecall).toBeCloseTo(golden.metrics.alignedRecallAt3, 9)
    expect(adversarial.topKRecall).toBeCloseTo(golden.metrics.adversarialRecallAt8, 9)
  })

  it('every semantic target clears the raw-cosine floor (distinct from a recall drop)', () => {
    const { resources, stringIdByNumericId } = toResourceFixtures(loadCorpus())
    const byStringId = new Map(resources.map((r) => [stringIdByNumericId.get(r.id) ?? '', r]))
    const semantic = loadAdversarialQuestions().filter((q) => q.bucket === 'semantic')

    const belowFloor: string[] = []
    for (const q of semantic) {
      const target = q.expectedId ? byStringId.get(q.expectedId) : undefined
      if (!target) continue
      const qv = golden.vectors[buildQueryText(q.q)]
      const dv = golden.vectors[buildEmbedText(target)]
      expect(qv, `query vec for ${q.q}`).toBeDefined()
      expect(dv, `doc vec for ${q.expectedId}`).toBeDefined()
      // L2-normalized vectors -> cosine == dot product. Mirror the runtime drop
      // condition EXACTLY (`< floor`): a target at exactly the floor is KEPT by
      // the retriever, so it must not be flagged here.
      const cosine = qv.reduce((s, x, i) => s + x * dv[i], 0)
      if (cosine < EMBED_MIN_COSINE_FLOOR) {
        belowFloor.push(`${q.expectedId}: cosine ${cosine.toFixed(4)} < floor ${EMBED_MIN_COSINE_FLOOR}  ("${q.q}")`)
      }
    }
    if (belowFloor.length > 0) console.error('semantic targets below the raw-cosine floor:\n' + belowFloor.join('\n'))
    expect(belowFloor, 'a correct semantic target sits below the raw-cosine floor and would be dropped pre-decider').toEqual([])
  })
})
