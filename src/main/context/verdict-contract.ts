/**
 * The load-bearing safety validator. Copilot is an untrusted adapter: its raw
 * decide-stage output is parsed and validated here, in pure app code, before the
 * app acts on it. A malformed, partial, prose-wrapped, or out-of-candidate
 * response fails closed to a safe `none` — never a guess. This module is
 * exhaustively unit-tested because it is the contract, not the prompt.
 */

/** The decision the LLM is allowed to make. It never returns a live value. */
export type DecisionVerdict = 'confident' | 'clarify' | 'none'

/** A validated, app-trustworthy decision. */
export interface ValidatedDecision {
  verdict: DecisionVerdict
  /** The chosen candidate's opaque id — present (and in the allowed set) iff confident. */
  citedCandidateId: string | null
  /** One clarifying question — present iff clarify. */
  clarifyQuestion: string | null
  /** Candidate opaque ids to show for a clarify — a validated subset of the allowed set. */
  candidateIds: string[]
}

export type ContractResult =
  | { ok: true; decision: ValidatedDecision }
  | { ok: false; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Parses the LLM's raw decide-stage text and validates it against the allowed
 * opaque candidate ids. Returns a ValidatedDecision or a violation reason (the
 * caller treats any violation as `model_bad_output` and fails closed to `none`).
 */
export function parseAndValidateDecision(rawContent: string, allowedIds: string[]): ContractResult {
  const allowed = new Set(allowedIds)

  const trimmed = rawContent.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty decision output' }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, reason: 'decision output was not valid JSON' }
  }

  if (!isRecord(parsed)) return { ok: false, reason: 'decision output was not a JSON object' }

  const verdict = parsed.verdict
  if (verdict !== 'confident' && verdict !== 'clarify' && verdict !== 'none') {
    return { ok: false, reason: `invalid verdict: ${JSON.stringify(verdict)}` }
  }

  if (verdict === 'confident') {
    const cited = parsed.citedCandidateId
    if (typeof cited !== 'string' || !allowed.has(cited)) {
      // A confident verdict MUST cite a candidate we offered. Anything else is a
      // fabricated / out-of-candidate citation — reject.
      return { ok: false, reason: `confident verdict cited an unknown candidate: ${JSON.stringify(cited)}` }
    }
    return {
      ok: true,
      decision: { verdict: 'confident', citedCandidateId: cited, clarifyQuestion: null, candidateIds: [] },
    }
  }

  if (verdict === 'clarify') {
    const question = typeof parsed.clarifyQuestion === 'string' ? parsed.clarifyQuestion.trim() : ''
    const rawIds = Array.isArray(parsed.candidateIds) ? parsed.candidateIds : []
    // Keep only ids we actually offered — a clarify can't invent candidates.
    const candidateIds = rawIds.filter((id): id is string => typeof id === 'string' && allowed.has(id))
    // A clarify is only useful if it either asks something or offers candidates.
    if (question.length === 0 && candidateIds.length === 0) {
      return { ok: false, reason: 'clarify verdict had no question and no valid candidates' }
    }
    return {
      ok: true,
      decision: {
        verdict: 'clarify',
        citedCandidateId: null,
        clarifyQuestion: question.length > 0 ? question : null,
        candidateIds,
      },
    }
  }

  // verdict === 'none'
  return {
    ok: true,
    decision: { verdict: 'none', citedCandidateId: null, clarifyQuestion: null, candidateIds: [] },
  }
}
