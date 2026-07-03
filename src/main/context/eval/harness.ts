import { readFileSync } from 'fs'
import { join } from 'path'
import type { Resource, ResourceKind } from '../../../shared/ipc-channels'
import { lexicalRetriever, type Retriever } from '../retrieve'

/**
 * Offline eval harness for the resolver's RETRIEVAL stage. It loads the
 * synthetic corpus + questions and reports top-1 / top-3 recall on fuzzy
 * questions and whether ambiguous questions surface >= 2 plausible candidates.
 *
 * This proves the deterministic half of the Gate 0 rubric (retrieval recall).
 * The full rubric (LLM right-source@1, negatives, clarify, live-value pull) is
 * the `--live` run that drives the real resolver with the Copilot decider.
 */

export interface EvalRecord {
  id: string
  title: string
  kind: ResourceKind
  source: string
  service: string
  env: string
  tags: Record<string, string>
  aliases: string[]
  description: string
  hasLiveSource: boolean
}

export type QuestionCategory = 'fuzzy' | 'negative' | 'ambiguous'

export interface EvalQuestion {
  q: string
  expectedId: string | null
  category: QuestionCategory
  acceptableIds?: string[]
}

interface CorpusFile {
  records: EvalRecord[]
}
interface QuestionsFile {
  questions: EvalQuestion[]
}

export function loadCorpus(): EvalRecord[] {
  const raw = readFileSync(join(__dirname, 'corpus.synthetic.json'), 'utf8')
  return (JSON.parse(raw) as CorpusFile).records
}

export function loadQuestions(): EvalQuestion[] {
  const raw = readFileSync(join(__dirname, 'questions.synthetic.json'), 'utf8')
  return (JSON.parse(raw) as QuestionsFile).questions
}

/** Maps an eval record to a full Resource (health defaults; numeric id = index+1). */
export function toResourceFixtures(records: EvalRecord[]): {
  resources: Resource[]
  stringIdByNumericId: Map<number, string>
} {
  const stringIdByNumericId = new Map<number, string>()
  const resources = records.map((rec, i): Resource => {
    const numericId = i + 1
    stringIdByNumericId.set(numericId, rec.id)
    return {
      id: numericId,
      projectId: 1,
      title: rec.title,
      kind: rec.kind,
      source: rec.source,
      service: rec.service,
      env: rec.env,
      tags: rec.tags,
      url: rec.hasLiveSource ? null : `https://example.test/${rec.id}`,
      description: rec.description,
      aliases: rec.aliases,
      provenance: 'manual',
      confidence: 0.5,
      lastUsed: null,
      lastVerified: null,
      failureCount: 0,
      suspect: false,
      pinnedGroup: null,
      mcpServer: rec.hasLiveSource ? 'synthetic-mcp' : null,
      toolName: rec.hasLiveSource ? 'query' : null,
      toolArgs: rec.hasLiveSource ? { id: rec.id } : null,
      externalRef: rec.id,
      validationState: 'unverified',
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
  })
  return { resources, stringIdByNumericId }
}

export interface RetrievalReport {
  fuzzyTotal: number
  top1Hits: number
  top3Hits: number
  top1Recall: number
  top3Recall: number
  ambiguousTotal: number
  ambiguousSurfaced: number
  /** Per-question detail for debugging failures. */
  misses: { q: string; expectedId: string; got: string[] }[]
}

/** Runs the retrieval-stage eval and returns recall metrics. */
export async function runRetrievalEval(
  retriever: Retriever = lexicalRetriever,
  k = 3,
  questions: EvalQuestion[] = loadQuestions()
): Promise<RetrievalReport> {
  const { resources, stringIdByNumericId } = toResourceFixtures(loadCorpus())

  let fuzzyTotal = 0
  let top1Hits = 0
  let top3Hits = 0
  let ambiguousTotal = 0
  let ambiguousSurfaced = 0
  const misses: RetrievalReport['misses'] = []

  for (const question of questions) {
    const results = await retriever.retrieve(question.q, resources, Math.max(k, 5))
    const rankedIds = results.map((r) => stringIdByNumericId.get(r.resource.id) ?? '')

    if (question.category === 'fuzzy' && question.expectedId !== null) {
      fuzzyTotal++
      if (rankedIds[0] === question.expectedId) top1Hits++
      if (rankedIds.slice(0, k).includes(question.expectedId)) {
        top3Hits++
      } else {
        misses.push({ q: question.q, expectedId: question.expectedId, got: rankedIds.slice(0, k) })
      }
    } else if (question.category === 'ambiguous') {
      ambiguousTotal++
      const acceptable = new Set(question.acceptableIds ?? [])
      const surfaced = rankedIds.slice(0, k).filter((id) => acceptable.has(id))
      if (surfaced.length >= 2) ambiguousSurfaced++
    }
  }

  return {
    fuzzyTotal,
    top1Hits,
    top3Hits,
    top1Recall: fuzzyTotal === 0 ? 0 : top1Hits / fuzzyTotal,
    top3Recall: fuzzyTotal === 0 ? 0 : top3Hits / fuzzyTotal,
    ambiguousTotal,
    ambiguousSurfaced,
    misses,
  }
}

/** Loads the adversarial (lexically-disjoint) question set. */
export function loadAdversarialQuestions(): EvalQuestion[] {
  const raw = readFileSync(join(__dirname, 'questions.adversarial.json'), 'utf8')
  return (JSON.parse(raw) as QuestionsFile).questions
}
