/**
 * LIVE resolver eval — NOT part of CI. Drives the REAL two-stage pipeline against
 * the synthetic corpus:
 *   assemble -> real `copilot -p` decide (isolated, no tools) -> validate
 *   -> app-owned MCP read (echo server) for the live-value pull.
 *
 * Run manually:  bun --bun run src/main/context/eval/live-eval.ts
 * It reports the Gate 0 rubric (right-source@1, negatives, clarify, citations,
 * plus one live-value pull). Uses sanitized/synthetic data + a synthetic MCP
 * server only — no real credentials or internal names.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadCorpus, loadQuestions, toResourceFixtures } from './harness'
import { assemble } from '../assemble'
import { buildDecidePrompt } from '../prompt'
import { parseAndValidateDecision } from '../verdict-contract'
import { createCopilotDecideRunner } from '../copilot-run'
import { createMcpRunner } from '../mcp-client'
import type { ProjectCard } from '../../../shared/ipc-channels'

const emptyCard: ProjectCard = {
  projectId: 1, purpose: 'Nimbus e-commerce platform reliability', repos: [], services: [],
  activeGoal: '', glossary: {}, updatedAt: '2026-01-01T00:00:00.000Z',
}

function isolatedHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'resolver-eval-'))
  mkdirSync(join(home, '.copilot'), { recursive: true })
  writeFileSync(join(home, '.copilot', 'mcp-config.json'), JSON.stringify({ mcpServers: {} }), 'utf8')
  return home
}

interface Outcome {
  q: string
  category: string
  expectedId: string | null
  verdict: string
  citedId: string | null
  cited: boolean
}

async function main(): Promise<void> {
  const { resources, stringIdByNumericId } = toResourceFixtures(loadCorpus())
  const questions = loadQuestions()
  const home = isolatedHome()
  const decideRunner = createCopilotDecideRunner({ isolatedHome: home, cwd: home, timeoutMs: 60_000 })

  const outcomes: Outcome[] = []

  // Limited concurrency to speed up without hammering the CLI.
  const CONCURRENCY = 3
  let idx = 0
  async function worker(): Promise<void> {
    while (idx < questions.length) {
      const i = idx++
      const question = questions[i]
      const { candidates } = assemble(question.q, emptyCard, resources)
      if (candidates.length === 0) {
        outcomes[i] = { q: question.q, category: question.category, expectedId: question.expectedId, verdict: 'none', citedId: null, cited: false }
        process.stdout.write(`. `)
        continue
      }
      const { prompt, candidateByOpaqueId, opaqueIds } = buildDecidePrompt(question.q, emptyCard, candidates)
      const run = await decideRunner.run(prompt)
      let verdict = 'none'
      let citedId: string | null = null
      let cited = false
      if (run.ok && run.content !== null) {
        const validated = parseAndValidateDecision(run.content, opaqueIds)
        if (validated.ok) {
          verdict = validated.decision.verdict
          if (validated.decision.verdict === 'confident' && validated.decision.citedCandidateId) {
            const c = candidateByOpaqueId.get(validated.decision.citedCandidateId)
            if (c) {
              citedId = stringIdByNumericId.get(c.resource.id) ?? null
              cited = true
            }
          } else if (validated.decision.verdict === 'clarify') {
            cited = validated.decision.candidateIds.length > 0
          }
        }
      }
      outcomes[i] = { q: question.q, category: question.category, expectedId: question.expectedId, verdict, citedId, cited }
      process.stdout.write(`. `)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  process.stdout.write('\n\n')

  // ── Rubric ──
  const fuzzy = outcomes.filter((o) => o.category === 'fuzzy')
  const negatives = outcomes.filter((o) => o.category === 'negative')
  const ambiguous = outcomes.filter((o) => o.category === 'ambiguous')

  const rightAt1 = fuzzy.filter((o) => o.verdict === 'confident' && o.citedId === o.expectedId).length
  // Negative handled = did NOT confidently cite a source (none or clarify are both safe).
  const negHandled = negatives.filter((o) => o.verdict !== 'confident').length
  const ambClarify = ambiguous.filter((o) => o.verdict === 'clarify' || o.verdict === 'none').length
  // Citations 100%: every confident verdict cited a real candidate (validator guarantees this).
  const confidentTotal = outcomes.filter((o) => o.verdict === 'confident').length
  const confidentCited = outcomes.filter((o) => o.verdict === 'confident' && o.cited).length

  console.log('=== LIVE RESOLVER EVAL (synthetic) ===')
  console.log(`right-source@1 (fuzzy): ${rightAt1}/${fuzzy.length} = ${((rightAt1 / fuzzy.length) * 100).toFixed(1)}%  [target >= 80%]`)
  console.log(`negatives handled:      ${negHandled}/${negatives.length} = ${((negHandled / negatives.length) * 100).toFixed(1)}%  [target >= 90%]`)
  console.log(`ambiguous -> clarify:   ${ambClarify}/${ambiguous.length}`)
  console.log(`citations on confident: ${confidentCited}/${confidentTotal} = 100% expected`)

  const fuzzyMisses = fuzzy.filter((o) => !(o.verdict === 'confident' && o.citedId === o.expectedId))
  if (fuzzyMisses.length > 0) {
    console.log('\nfuzzy misses:')
    for (const m of fuzzyMisses) console.log(`  - "${m.q}" -> ${m.verdict} (cited ${m.citedId ?? '-'}, expected ${m.expectedId})`)
  }
  const negLeaks = negatives.filter((o) => o.verdict === 'confident')
  if (negLeaks.length > 0) {
    console.log('\nnegative leaks (hallucinations):')
    for (const m of negLeaks) console.log(`  - "${m.q}" -> confidently cited ${m.citedId}`)
  }

  // ── One real app-owned live-value pull via the echo MCP server ──
  console.log('\n=== LIVE-VALUE PULL (app-owned MCP read, echo server) ===')
  const mcpRunner = createMcpRunner({ timeoutMs: 15_000 })
  const echoServer = { command: process.execPath, args: [join(__dirname, 'echo-mcp-server.mjs')], env: {} }
  const read = await mcpRunner.run(echoServer, 'echo', { metric: 'checkout.p99', value: '240ms' })
  console.log(`read.ok=${read.ok} value="${read.value}" failure=${read.failure ?? '-'}`)
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  }
)
