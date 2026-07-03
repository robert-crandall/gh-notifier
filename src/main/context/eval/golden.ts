import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Embedder } from '../embed'
import { EMBEDDING_MODEL_ID } from '../embed'
import { buildEmbedText, buildQueryText, EMBED_TEXT_VERSION } from '../retrieve'
import { loadCorpus, loadQuestions, loadAdversarialQuestions, toResourceFixtures } from './harness'

/**
 * Golden vectors: a hermetic, offline CI gate for the REAL hybrid retriever.
 *
 * Committing the ~23MB MiniLM model (or fetching it in CI) is out; instead we
 * commit precomputed vectors for every corpus doc + every eval question, keyed
 * to the exact embed-text string. A `GoldenEmbedder` looks those up (throwing on
 * an unknown string) and drives the REAL ranking (raw-cosine floor + structured
 * boost) in CI — so a regression in the retriever's math is caught offline,
 * deterministically, without a model download.
 *
 * The keys are the EXACT strings the runtime embeds (`buildEmbedText` /
 * `buildQueryText`), so golden and runtime can't drift. A drift test asserts the
 * committed vectors cover the current corpus+questions exactly.
 */

export const GOLDEN_PATH = join(__dirname, 'golden-vectors.json')

export interface GoldenMetrics {
  /** Aligned (lexically-echoing) recall@3 with the REAL hybrid retriever. */
  alignedRecallAt3: number
  /** Adversarial (zero-overlap semantic) recall@8 — the honest bar. */
  adversarialRecallAt8: number
}

export interface GoldenFile {
  /** Model the vectors were produced with (drift signal if it changes). */
  modelId: string
  /** Embed-text format version (drift signal if `buildEmbedText` changes). */
  embedTextVersion: string
  generatedAt: string
  /** Metrics the committed vectors reproduce (the CI test re-derives + asserts). */
  metrics: GoldenMetrics
  /** exact embed-text string -> committed vector. */
  vectors: Record<string, number[]>
}

/**
 * An `Embedder` backed by committed vectors. Looks up each text exactly; throws
 * on an unknown string so a drift (question/corpus edited without regenerating)
 * fails loudly instead of silently degrading retrieval.
 */
export class GoldenEmbedder implements Embedder {
  private readonly vectors: Record<string, number[]>

  constructor(vectors: Record<string, number[]>) {
    this.vectors = vectors
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vec = this.vectors[text]
      if (vec === undefined) {
        throw new Error(
          `GoldenEmbedder: no committed vector for text ${JSON.stringify(text)} — ` +
            `regenerate golden vectors with \`--update-golden\``
        )
      }
      return vec
    })
  }
}

export function loadGoldenFile(): GoldenFile {
  if (!existsSync(GOLDEN_PATH)) {
    throw new Error(`golden vectors not found at ${GOLDEN_PATH} — run generate-golden with --update-golden`)
  }
  return JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenFile
}

/**
 * Every exact string the runtime will embed for the current corpus + all eval
 * questions: `buildEmbedText` for each corpus doc + `buildQueryText` for each
 * question. Independently recomputed (not captured) so the drift test can prove
 * the committed keys still cover what the runtime asks for.
 */
export function enumerateEmbedTexts(): string[] {
  const { resources } = toResourceFixtures(loadCorpus())
  const docTexts = resources.map((r) => buildEmbedText(r))
  const questions = [...loadQuestions(), ...loadAdversarialQuestions()]
  const queryTexts = questions.map((question) => buildQueryText(question.q))
  return [...new Set([...docTexts, ...queryTexts])]
}

/** The current (model, embed-text) identity the golden file must match. */
export function currentGoldenIdentity(): { modelId: string; embedTextVersion: string } {
  return { modelId: EMBEDDING_MODEL_ID, embedTextVersion: EMBED_TEXT_VERSION }
}
