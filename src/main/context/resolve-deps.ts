import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createCopilotDecideRunner } from './copilot-run'
import { createDefaultRetriever } from './retrieve'
import { createLocalEmbedder, type Embedder, type EmbedderOptions } from './embed'
import { FAST_RECOMMEND_MODEL, type RecommendDeps } from './recommend'

/**
 * Builds the recommendation path's runtime dependencies with the ranking call
 * isolated: an app-owned Copilot HOME containing an empty MCP config, so the
 * ranking subprocess loads none of the user's global MCP servers and has no
 * tools — it can only SELECT/ORDER saved-source ids, never execute.
 *
 * Retrieval uses the hybrid embedding retriever (semantic recall for
 * lexically-disjoint questions) with a transparent lexical fallback if the local
 * model can't load.
 */

/** Creates an isolated Copilot home with an empty MCP config; returns its path. */
export function ensureIsolatedCopilotHome(baseDir: string): string {
  const home = join(baseDir, 'copilot-resolver-home')
  mkdirSync(join(home, '.copilot'), { recursive: true })
  writeFileSync(join(home, '.copilot', 'mcp-config.json'), JSON.stringify({ mcpServers: {} }), 'utf8')
  return home
}

export interface ResolveDepsOptions {
  /** Writable dir for the recommendation path's own state (the isolated Copilot home). */
  stateDir: string
  /**
   * How the local embedding model is provisioned for this environment (from
   * `resolveModelProvisioning`). Passed straight to the embedder. The model dir
   * is NEVER created here — in a packaged app it lives under a read-only
   * Resources path; dev provisioning is the `provision-model` script's job.
   */
  embedderOptions?: EmbedderOptions
  /**
   * Injectable embedder — ONLY so the composition-root guard test can prove the
   * wiring performs real semantic retrieval on a non-empty corpus with a
   * deterministic fake. Production always uses the local MiniLM embedder.
   */
  embedder?: Embedder
}

/**
 * Builds the recommendation path's runtime dependencies.
 */
export function createResolveDeps(options: ResolveDepsOptions): RecommendDeps {
  const { stateDir, embedderOptions, embedder } = options
  const home = ensureIsolatedCopilotHome(stateDir)
  const resolvedEmbedder = embedder ?? createLocalEmbedder(embedderOptions)
  return {
    // Read-only recommendation ranking uses a tool-less isolated runner with a
    // fast model pinned — never a live read, never a value.
    recommendRunner: createCopilotDecideRunner({ isolatedHome: home, cwd: home, model: FAST_RECOMMEND_MODEL }),
    assembleOptions: { retriever: createDefaultRetriever(resolvedEmbedder) },
  }
}
