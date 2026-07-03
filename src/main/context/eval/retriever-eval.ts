/**
 * Manual retriever eval — NOT part of CI (needs a local embedding model to load,
 * which downloads once and can't run offline in CI). Compares the lexical vs the
 * real embedding retriever on the ALIGNED and ADVERSARIAL (lexically-disjoint)
 * synthetic question sets, and reports top-1 / top-3 recall.
 *
 * Run: bun --bun run src/main/context/eval/retriever-eval.ts
 */
import { runRetrievalEval, loadQuestions, loadAdversarialQuestions, loadCorpus, toResourceFixtures } from './harness'
import { lexicalRetriever, createDefaultRetriever } from '../retrieve'
import { createLocalEmbedder } from '../embed'

async function main(): Promise<void> {
  // createDefaultRetriever is the production retriever (hybrid embedding + structured
  // bonus, with a lexical fallback) — the same thing the app wires in resolve-deps.
  const embedding = createDefaultRetriever(createLocalEmbedder())
  const aligned = loadQuestions()
  const adversarial = loadAdversarialQuestions()

  console.log('Loading embedding model (downloads once)...')
  const t0 = Date.now()
  // Warm up against a non-empty corpus so the model actually loads now (an empty
  // corpus short-circuits before embedding), making the timing meaningful.
  const { resources } = toResourceFixtures(loadCorpus())
  await embedding.retrieve('warmup', resources.slice(0, 1), 1)
  console.log(`model ready in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)

  console.log('=== RETRIEVER EVAL (synthetic) ===')
  console.log('recall@3 (strict top-3) and recall@8 (what the decider actually sees, cap=8):\n')
  const report = async (label: string, r: typeof lexicalRetriever, qs = aligned): Promise<void> => {
    const at3 = await runRetrievalEval(r, 3, qs)
    const at8 = await runRetrievalEval(r, 8, qs)
    console.log(
      `${label.padEnd(26)} recall@3 ${(at3.top3Recall * 100).toFixed(1).padStart(5)}%   recall@8 ${(at8.top3Recall * 100).toFixed(1).padStart(5)}%   (n=${at3.fuzzyTotal})`
    )
  }
  await report('lexical   / aligned', lexicalRetriever, aligned)
  await report('embedding / aligned', embedding, aligned)
  console.log('')
  await report('lexical   / adversarial', lexicalRetriever, adversarial)
  await report('embedding / adversarial', embedding, adversarial)

  const embAdv8 = await runRetrievalEval(embedding, 8, adversarial)
  console.log(`\nembedding adversarial misses at cap=8 (the decider never sees these; alias-capture-by-use closes them over time):`)
  for (const m of embAdv8.misses) console.log(`  - "${m.q}" -> expected ${m.expectedId}, got [${m.got.join(', ') || '(nothing)'}]`)
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  }
)
