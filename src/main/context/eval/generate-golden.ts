/**
 * Regenerates the committed golden vectors. Run manually (NOT in CI):
 *
 *   bun --bun run src/main/context/eval/generate-golden.ts --update-golden
 *
 * It runs the REAL MiniLM model, captures the EXACT string embedded for every
 * corpus doc + eval question (via a recording wrapper around the real embedder,
 * so golden keys can't drift from runtime), rounds the vectors, and — before
 * writing — REFUSES to overwrite if the adversarial/aligned metrics regressed vs
 * the currently-committed file. This makes "refresh golden vectors" incapable of
 * silently blessing a worse embed-text.
 */
import { writeFileSync, existsSync, readFileSync } from 'fs'
import type { Embedder } from '../embed'
import { createLocalEmbedder } from '../embed'
import { createEmbeddingRetriever } from '../retrieve'
import { loadCorpus, loadQuestions, loadAdversarialQuestions, toResourceFixtures, runRetrievalEval } from './harness'
import {
  GOLDEN_PATH,
  GoldenEmbedder,
  currentGoldenIdentity,
  type GoldenFile,
  type GoldenMetrics,
} from './golden'

/** Absolute floors (Gate 0 rubric: top-3/recall stays high). */
const MIN_ALIGNED_RECALL_AT3 = 0.9
const MIN_ADVERSARIAL_RECALL_AT8 = 0.9
const EPS = 1e-9

/** Wraps an embedder to capture the exact strings passed to embed(). */
function recordingEmbedder(real: Embedder, sink: Map<string, number[]>): Embedder {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      const vecs = await real.embed(texts)
      texts.forEach((text, i) => sink.set(text, vecs[i]))
      return vecs
    },
  }
}

function round6(v: number[]): number[] {
  return v.map((x) => Math.round(x * 1e6) / 1e6)
}

async function computeMetrics(embedder: Embedder): Promise<GoldenMetrics> {
  const retriever = createEmbeddingRetriever(embedder)
  const aligned = await runRetrievalEval(retriever, 3, loadQuestions())
  const adversarial = await runRetrievalEval(retriever, 8, loadAdversarialQuestions())
  return { alignedRecallAt3: aligned.topKRecall, adversarialRecallAt8: adversarial.topKRecall }
}

async function main(): Promise<void> {
  if (!process.argv.includes('--update-golden')) {
    console.error('refusing to run without --update-golden (this regenerates committed vectors)')
    process.exit(2)
  }

  const identity = currentGoldenIdentity()
  console.error(`generating golden vectors for ${identity.modelId} (embed-text ${identity.embedTextVersion})...`)

  // 1) Record exact embed strings + full-precision vectors from the REAL model.
  const rawSink = new Map<string, number[]>()
  const real = createLocalEmbedder()
  const recording = recordingEmbedder(real, rawSink)
  const recordingRetriever = createEmbeddingRetriever(recording)
  const { resources } = toResourceFixtures(loadCorpus())
  const questions = [...loadQuestions(), ...loadAdversarialQuestions()]
  for (const question of questions) {
    // Drives embed() for the query + (on the first question) every corpus doc.
    await recordingRetriever.retrieve(question.q, resources, 8)
  }

  // 2) Round to commit-friendly precision. Metrics are computed from the ROUNDED
  //    vectors so what CI reproduces is exactly what we commit.
  const rounded: Record<string, number[]> = {}
  for (const [text, vec] of rawSink) rounded[text] = round6(vec)
  const roundedEmbedder = new GoldenEmbedder(rounded)
  const metrics = await computeMetrics(roundedEmbedder)
  console.error(
    `metrics (rounded): aligned recall@3 ${(metrics.alignedRecallAt3 * 100).toFixed(1)}%  ` +
      `adversarial recall@8 ${(metrics.adversarialRecallAt8 * 100).toFixed(1)}%`
  )

  // 3) Absolute floor.
  if (metrics.alignedRecallAt3 < MIN_ALIGNED_RECALL_AT3 || metrics.adversarialRecallAt8 < MIN_ADVERSARIAL_RECALL_AT8) {
    console.error(
      `REFUSING to write: metrics below floor ` +
        `(aligned>=${MIN_ALIGNED_RECALL_AT3}, adversarial>=${MIN_ADVERSARIAL_RECALL_AT8})`
    )
    process.exit(1)
  }

  // 4) Regression guard vs the currently-committed golden file.
  if (existsSync(GOLDEN_PATH)) {
    const prev = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenFile
    if (
      metrics.alignedRecallAt3 + EPS < prev.metrics.alignedRecallAt3 ||
      metrics.adversarialRecallAt8 + EPS < prev.metrics.adversarialRecallAt8
    ) {
      console.error(
        `REFUSING to write: metrics regressed vs committed ` +
          `(aligned ${prev.metrics.alignedRecallAt3}->${metrics.alignedRecallAt3}, ` +
          `adversarial ${prev.metrics.adversarialRecallAt8}->${metrics.adversarialRecallAt8}). ` +
          `A refresh must never bless a worse embed-text.`
      )
      process.exit(1)
    }
  }

  // 5) Write, keys sorted for a stable diff.
  const sortedVectors: Record<string, number[]> = {}
  for (const key of Object.keys(rounded).sort()) sortedVectors[key] = rounded[key]
  const file: GoldenFile = {
    modelId: identity.modelId,
    embedTextVersion: identity.embedTextVersion,
    generatedAt: new Date().toISOString(),
    metrics,
    vectors: sortedVectors,
  }
  writeFileSync(GOLDEN_PATH, JSON.stringify(file, null, 2) + '\n', 'utf8')
  console.error(`wrote ${Object.keys(sortedVectors).length} vectors to ${GOLDEN_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
