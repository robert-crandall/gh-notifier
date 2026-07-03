import type { ProjectCard } from '../../shared/ipc-channels'
import type { AssembledCandidate } from './assemble'

/**
 * Decide-stage prompt building. Pure and dependency-light (no DB/electron) so it
 * can be reused by the live eval harness. Candidates are referenced ONLY by
 * opaque ids so the untrusted model can't cite anything outside the offered set,
 * and the project card is context (never a citable candidate).
 */

export interface DecidePromptBundle {
  prompt: string
  /** opaque id (c1..cN) -> the assembled candidate. */
  candidateByOpaqueId: Map<string, AssembledCandidate>
  /** the opaque ids we offered, for the validator's allowed set. */
  opaqueIds: string[]
}

function opaqueId(index: number): string {
  return `c${index + 1}`
}

export function buildDecidePrompt(
  question: string,
  card: ProjectCard,
  candidates: AssembledCandidate[]
): DecidePromptBundle {
  const candidateByOpaqueId = new Map<string, AssembledCandidate>()
  const opaqueIds: string[] = []

  const candidateLines = candidates.map((c, i) => {
    const id = opaqueId(i)
    opaqueIds.push(id)
    candidateByOpaqueId.set(id, c)
    const r = c.resource
    const parts = [
      `id: ${id}`,
      `title: ${r.title}`,
      `kind: ${r.kind}`,
      `source: ${r.source}`,
      r.service ? `service: ${r.service}` : '',
      r.env ? `env: ${r.env}` : '',
      r.aliases.length > 0 ? `aliases: ${r.aliases.join(', ')}` : '',
      r.description ? `description: ${r.description}` : '',
    ].filter((p) => p.length > 0)
    return `- ${parts.join(' | ')}`
  })

  const cardLines = [
    card.purpose ? `purpose: ${card.purpose}` : '',
    card.services.length > 0 ? `services: ${card.services.join(', ')}` : '',
    card.activeGoal ? `active goal: ${card.activeGoal}` : '',
  ].filter((l) => l.length > 0)

  const prompt = [
    'You are a resource resolver. Decide which ONE saved source best answers the user question.',
    'Rules:',
    '- Choose exactly one candidate only if it clearly answers the question -> verdict "confident".',
    '- If two or more candidates are plausible, or you are unsure which is right, -> verdict "clarify".',
    '- If none of the candidates fit -> verdict "none".',
    '- Refer to candidates ONLY by their opaque id (c1, c2, ...). Never invent an id.',
    '- Do NOT run any tools. Do NOT compute a value. Only pick.',
    '- Respond with ONLY a single-line JSON object, no prose, matching:',
    '  {"verdict":"confident","citedCandidateId":"c1"}',
    '  {"verdict":"clarify","clarifyQuestion":"...","candidateIds":["c1","c2"]}',
    '  {"verdict":"none"}',
    '',
    cardLines.length > 0 ? `Project context (do not cite this):\n${cardLines.join('\n')}` : 'Project context: (none)',
    '',
    'Candidates:',
    candidateLines.join('\n'),
    '',
    `Question: ${question}`,
  ].join('\n')

  return { prompt, candidateByOpaqueId, opaqueIds }
}
