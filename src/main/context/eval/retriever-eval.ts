/**
 * Manual retriever eval — NOT part of CI (needs a local embedding model to load,
 * which downloads once and can't run offline in CI). Compares the lexical vs the
 * real embedding retriever on the ALIGNED and ADVERSARIAL (lexically-disjoint)
 * synthetic question sets, and reports top-1 / top-3 recall.
 *
 * Run: bun --bun run src/main/context/eval/retriever-eval.ts
 */
import { runRetrievalEval, loadQuestions, loadAdversarialQuestions } from './harness'
import { lexicalRetriever, createDefaultRetriever } from '../retrieve'
import { createLocalEmbedder } from '../embed'

async function main(): Promise<void> {
  // createDefaultRetriever is the production retriever (hybrid embedding + structured
  // bonus, with a lexical fallback) — the same thing the app wires in resolve-deps.
  const embedding = createDefaultRetriever(createLocalEmbedder())
  const aligned = loadQuestions()
  const adversarial = loadAdversarialQuestions()

  const line = (label: string, r: { top1Recall: number; top3Recall: number; fuzzyTotal: number }): string =>
    `${label.padEnd(26)} top1 ${(r.top1Recall * 100).toFixed(1).padStart(5)}%   top3 ${(r.top3Recall * 100).toFixed(1).padStart(5)}%   (n=${r.fuzzyTotal})`

  console.log('Loading embedding model (downloads once)...')
  const t0 = Date.now()
  await embedding.retrieve('warmup', [], 1)
  console.log(`model ready in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)

  console.log('=== RETRIEVER EVAL (synthetic) ===')
  console.log(line('lexical   / aligned', await runRetrievalEval(lexicalRetriever, 3, aligned)))
  console.log(line('embedding / aligned', await runRetrievalEval(embedding, 3, aligned)))
  console.log('')
  console.log(line('lexical   / adversarial', await runRetrievalEval(lexicalRetriever, 3, adversarial)))
  const embAdv = await runRetrievalEval(embedding, 3, adversarial)
  console.log(line('embedding / adversarial', embAdv))
  console.log(`\nembedding adversarial misses (hard/ambiguous phrasings; the LLM stage answers none/clarify, and the alias-capture loop closes these over time):`)
  for (const m of embAdv.misses) console.log(`  - "${m.q}" -> expected ${m.expectedId}, got [${m.got.join(', ') || '(nothing)'}]`)
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  }
)
