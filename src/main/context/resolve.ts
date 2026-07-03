import type { ResolveCitation, ResolveResult, Resource } from '../../shared/ipc-channels'
import { assemble, type AssembleOptions, type AssembledCandidate } from './assemble'
import { buildDecidePrompt } from './prompt'
import { parseAndValidateDecision } from './verdict-contract'
import type { DecideRunner } from './copilot-run'
import type { McpRunner } from './mcp-client'
import {
  getProjectCard,
  listResources,
  getMcpServer,
  markResourceUsed,
  markResourceSuspect,
  recordResolution,
} from './registry'

// Re-exported so callers that already import it from here keep working.
export { buildDecidePrompt } from './prompt'
export type { DecidePromptBundle } from './prompt'

/**
 * The resolver orchestrator — the heart of MVP C. Two-stage, with a hard trust
 * boundary:
 *   1. retrieve + assemble (deterministic, offline)
 *   2. decide (untrusted Copilot, tools denied, opaque candidate ids) -> validate
 *   3. run (app-owned MCP read; the ONLY producer of a live value)
 *
 * The DecideRunner and McpRunner are injected so this is testable offline. All
 * DB reads/writes go through registry.ts.
 */

export interface ResolveDeps {
  decideRunner: DecideRunner
  mcpRunner: McpRunner
  assembleOptions?: AssembleOptions
}

// ── Result helpers ────────────────────────────────────────────────────────────

function toCitation(resource: Resource): ResolveCitation {
  return {
    resourceId: resource.id,
    title: resource.title,
    kind: resource.kind,
    source: resource.source,
    url: resource.url,
    // Staleness surfaces only when relevant: this record is being cited/offered now.
    suspect: resource.suspect,
  }
}

function noneResult(answer: string, failureClass: ResolveResult['failureClass'] = null): ResolveResult {
  return {
    verdict: 'none',
    answer,
    citation: null,
    liveValue: null,
    clarifyQuestion: null,
    candidates: [],
    failureClass,
  }
}

// ── The orchestrator ──────────────────────────────────────────────────────────

export async function resolveQuestion(
  projectId: number,
  question: string,
  deps: ResolveDeps
): Promise<ResolveResult> {
  const trimmed = question.trim()
  if (trimmed.length === 0) return noneResult('Ask a question to resolve a source.')

  const card = getProjectCard(projectId)
  const corpus = listResources(projectId)
  const { candidates } = assemble(trimmed, card, corpus, deps.assembleOptions)

  // No candidates at all -> honestly, no source saved.
  if (candidates.length === 0) {
    const result = noneResult('No source saved for that.')
    recordResolution({
      projectId,
      resourceId: null,
      question: trimmed,
      verdict: 'none',
      citedResourceId: null,
      answer: result.answer,
      failureClass: null,
    })
    return result
  }

  const { prompt, candidateByOpaqueId, opaqueIds } = buildDecidePrompt(trimmed, card, candidates)

  // Stage 2: untrusted decide.
  const run = await deps.decideRunner.run(prompt)
  if (!run.ok || run.content === null) {
    // Infra/model failure of the decide call — fail closed, mark NO resource suspect.
    const failureClass = run.failure === 'timeout' ? 'timeout' : run.failure === 'model_bad_output' ? 'model_bad_output' : 'connector_down'
    const result = noneResult("I couldn't complete that lookup just now — try again in a moment.", failureClass)
    recordResolution({
      projectId,
      resourceId: null,
      question: trimmed,
      verdict: 'none',
      citedResourceId: null,
      answer: result.answer,
      failureClass,
    })
    return result
  }

  const validated = parseAndValidateDecision(run.content, opaqueIds)
  if (!validated.ok) {
    // The model produced something we can't trust — fail closed to none.
    const result = noneResult("I couldn't resolve that reliably.", 'model_bad_output')
    recordResolution({
      projectId,
      resourceId: null,
      question: trimmed,
      verdict: 'none',
      citedResourceId: null,
      answer: result.answer,
      failureClass: 'model_bad_output',
    })
    return result
  }

  const decision = validated.decision

  if (decision.verdict === 'none') {
    const result = noneResult('No source saved for that.')
    recordResolution({
      projectId,
      resourceId: null,
      question: trimmed,
      verdict: 'none',
      citedResourceId: null,
      answer: result.answer,
      failureClass: null,
    })
    return result
  }

  if (decision.verdict === 'clarify') {
    const candidateCitations = decision.candidateIds
      .map((id) => candidateByOpaqueId.get(id))
      .filter((c): c is AssembledCandidate => c !== undefined)
      .map((c) => toCitation(c.resource))
    const result: ResolveResult = {
      verdict: 'clarify',
      answer: decision.clarifyQuestion ?? 'Which of these did you mean?',
      citation: null,
      liveValue: null,
      clarifyQuestion: decision.clarifyQuestion,
      candidates: candidateCitations,
      failureClass: null,
    }
    recordResolution({
      projectId,
      resourceId: null,
      question: trimmed,
      verdict: 'clarify',
      citedResourceId: null,
      answer: result.answer,
      failureClass: null,
    })
    return result
  }

  // decision.verdict === 'confident': app owns the read.
  const cited = decision.citedCandidateId !== null ? candidateByOpaqueId.get(decision.citedCandidateId) : undefined
  if (cited === undefined) {
    // Should be impossible after validation, but fail closed.
    const result = noneResult("I couldn't resolve that reliably.", 'model_bad_output')
    recordResolution({
      projectId,
      resourceId: null,
      question: trimmed,
      verdict: 'none',
      citedResourceId: null,
      answer: result.answer,
      failureClass: 'model_bad_output',
    })
    return result
  }

  return runCitedSource(projectId, trimmed, cited.resource, deps)
}

/** Stage 3: the app-owned read of the cited source. Never trusts Copilot for a value. */
async function runCitedSource(
  projectId: number,
  question: string,
  resource: Resource,
  deps: ResolveDeps
): Promise<ResolveResult> {
  const citation = toCitation(resource)

  // No wired live source -> cite it honestly, no fabricated value.
  if (resource.mcpServer === null || resource.toolName === null) {
    markResourceUsed(resource.id, false)
    const result: ResolveResult = {
      verdict: 'source_available_no_live_value',
      answer: `Found the saved source: ${resource.title}. No live source is wired, so open it directly.`,
      citation,
      liveValue: null,
      clarifyQuestion: null,
      candidates: [],
      failureClass: null,
    }
    recordResolution({
      projectId,
      resourceId: resource.id,
      question,
      verdict: 'source_available_no_live_value',
      citedResourceId: resource.id,
      answer: result.answer,
      failureClass: null,
    })
    return result
  }

  const server = getMcpServer(resource.mcpServer)
  if (server === null) {
    // The wiring is gone (infra/config), not the source itself — do NOT mark suspect.
    markResourceUsed(resource.id, false)
    const result: ResolveResult = {
      verdict: 'source_available_no_live_value',
      answer: `Found ${resource.title}, but its data connection isn't configured. Open it directly.`,
      citation,
      liveValue: null,
      clarifyQuestion: null,
      candidates: [],
      failureClass: 'connector_down',
    }
    recordResolution({
      projectId,
      resourceId: resource.id,
      question,
      verdict: 'source_available_no_live_value',
      citedResourceId: resource.id,
      answer: result.answer,
      failureClass: 'connector_down',
    })
    return result
  }

  const read = await deps.mcpRunner.run(server.config, resource.toolName, resource.toolArgs ?? {})

  if (read.ok && read.value !== null) {
    markResourceUsed(resource.id, true)
    const result: ResolveResult = {
      verdict: 'confident',
      answer: read.value,
      citation: toCitation({ ...resource, suspect: false }),
      liveValue: read.value,
      clarifyQuestion: null,
      candidates: [],
      failureClass: null,
    }
    recordResolution({
      projectId,
      resourceId: resource.id,
      question,
      verdict: 'confident',
      citedResourceId: resource.id,
      answer: result.answer,
      failureClass: null,
    })
    return result
  }

  // The read failed. Classify bad-source vs bad-infra.
  const failure = read.failure ?? 'connector_down'
  if (failure === 'query_invalid' || failure === 'no_data') {
    // The SOURCE itself is bad -> mark suspect + down-rank going forward.
    markResourceSuspect(resource.id, failure === 'no_data' ? 'no_data' : 'invalid', failure, read.reason)
  }
  // Infra failures (auth_missing/connector_down/timeout) do NOT mark the source suspect.

  const answer =
    failure === 'no_data'
      ? `Found ${resource.title}, but the query returned no data (flagged for re-verify).`
      : failure === 'query_invalid'
        ? `Found ${resource.title}, but its query looks broken (flagged for re-verify).`
        : `Found ${resource.title}, but I couldn't read it just now. Open it directly.`

  const result: ResolveResult = {
    verdict: 'source_available_no_live_value',
    // Reflect the (possibly newly-)suspect state to the UI so staleness surfaces in context.
    citation: { ...citation, suspect: failure === 'query_invalid' || failure === 'no_data' ? true : citation.suspect },
    answer,
    liveValue: null,
    clarifyQuestion: null,
    candidates: [],
    failureClass: failure,
  }
  recordResolution({
    projectId,
    resourceId: resource.id,
    question,
    verdict: 'source_available_no_live_value',
    citedResourceId: resource.id,
    answer: result.answer,
    failureClass: failure,
  })
  return result
}
