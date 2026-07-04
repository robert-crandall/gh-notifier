import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createCopilotDecideRunner } from './copilot-run'
import { createMcpRunner } from './mcp-client'
import { createDefaultRetriever } from './retrieve'
import { createLocalEmbedder, type Embedder, type EmbedderOptions } from './embed'
import { FAST_RECOMMEND_MODEL, type RecommendDeps } from './recommend'
import type { ResolveDeps } from './resolve'

/**
 * Builds the resolver's runtime dependencies with the decide call isolated:
 * an app-owned Copilot HOME containing an empty MCP config, so the decide
 * subprocess loads none of the user's global MCP servers and has no tools. The
 * app-owned MCP read (mcp-client) is what actually talks to wired servers.
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
  /** Writable dir for the resolver's own state (the isolated Copilot home). */
  stateDir: string
  /**
   * How the local embedding model is provisioned for this environment (from
   * `resolveModelProvisioning`). Passed straight to the embedder. The model dir
   * is NEVER created here — in a packaged app it lives under a read-only
   * Resources path; dev provisioning is the `provision-model` script's job.
   */
  embedderOptions?: EmbedderOptions
  /** Optional decide-model override. */
  model?: string
  /**
   * Injectable embedder — ONLY so the composition-root guard test can prove the
   * wiring performs real semantic retrieval on a non-empty corpus with a
   * deterministic fake. Production always uses the local MiniLM embedder.
   */
  embedder?: Embedder
}

/**
 * Builds the resolver's runtime dependencies.
 */
export function createResolveDeps(options: ResolveDepsOptions): ResolveDeps & RecommendDeps {
  const { stateDir, embedderOptions, model, embedder } = options
  const home = ensureIsolatedCopilotHome(stateDir)
  const resolvedEmbedder = embedder ?? createLocalEmbedder(embedderOptions)
  return {
    decideRunner: createCopilotDecideRunner({ isolatedHome: home, cwd: home, model }),
    // Read-only recommendation ranking uses the SAME tool-less isolated runner
    // with a fast model pinned — never a live read, never a value.
    recommendRunner: createCopilotDecideRunner({ isolatedHome: home, cwd: home, model: FAST_RECOMMEND_MODEL }),
    mcpRunner: createMcpRunner(),
    assembleOptions: { retriever: createDefaultRetriever(resolvedEmbedder) },
  }
}
