import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createResolveDeps } from './resolve-deps'
import { lexicalRetriever, buildEmbedText, buildQueryText } from './retrieve'
import { loadCorpus, toResourceFixtures } from './eval/harness'
import type { Embedder } from './embed'

/**
 * Composition-root guard: the production wiring MUST configure the embedding
 * (default) retriever, never the plain lexical one. This is the structural
 * defense against silently shipping the false-pass behavior — if someone swaps
 * production back to lexical retrieval, this fails.
 */
describe('createResolveDeps (production composition root)', () => {
  function tmp(prefix: string): string {
    return mkdtempSync(join(tmpdir(), prefix))
  }

  it('wires a retriever that is NOT the plain lexical retriever, plus decide + MCP runners', () => {
    const deps = createResolveDeps({ stateDir: tmp('resolve-deps-guard-') })
    expect(deps.assembleOptions?.retriever).toBeDefined()
    expect(deps.assembleOptions?.retriever).not.toBe(lexicalRetriever)
    expect(deps.decideRunner).toBeDefined()
    expect(deps.mcpRunner).toBeDefined()
  })

  it('performs REAL semantic retrieval on a non-empty corpus (retrieves what lexical cannot)', async () => {
    // A genuinely lexically-disjoint question (from the honesty-guarded semantic
    // set): the lexical retriever provably CANNOT reach the target. A fake
    // deterministic embedder makes the target win by cosine — so if production
    // had wired lexical (or a wrapper that only reports 'semantic' on an empty
    // corpus), this fails.
    const { resources, stringIdByNumericId } = toResourceFixtures(loadCorpus())
    const question = 'how often do lookups avoid a round trip to disk?'
    const targetStringId = 'cache-hit-rate-dash'
    const targetNumericId = [...stringIdByNumericId].find(([, s]) => s === targetStringId)?.[0]
    expect(targetNumericId, 'target must exist in the corpus').toBeDefined()

    // Fake embedder: the query and the target doc share a direction; every other
    // doc is orthogonal (cosine 0, below the floor -> filtered).
    const vectors = new Map<string, number[]>()
    vectors.set(buildQueryText(question), [1, 0, 0])
    for (const r of resources) vectors.set(buildEmbedText(r), r.id === targetNumericId ? [1, 0, 0] : [0, 1, 0])
    const fakeEmbedder: Embedder = {
      async embed(texts: string[]): Promise<number[][]> {
        return texts.map((t) => {
          const v = vectors.get(t)
          if (!v) throw new Error(`fake embedder: no vector for ${JSON.stringify(t)}`)
          return v
        })
      },
    }

    const deps = createResolveDeps({ stateDir: tmp('resolve-deps-sem-'), embedder: fakeEmbedder })
    const outcome = await deps.assembleOptions!.retriever!.retrieve(question, resources, 8)
    expect(outcome.mode).toBe('semantic')
    expect(stringIdByNumericId.get(outcome.candidates[0]?.resource.id)).toBe(targetStringId)

    // Prove the target is genuinely lexical-unreachable, so this couldn't pass
    // with a lexical retriever wired.
    const lex = await lexicalRetriever.retrieve(question, resources, 8)
    expect(lex.candidates.map((c) => stringIdByNumericId.get(c.resource.id))).not.toContain(targetStringId)
  })
})
