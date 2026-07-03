import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createCopilotDecideRunner } from './copilot-run'
import { createMcpRunner } from './mcp-client'
import { createDefaultRetriever } from './retrieve'
import { createLocalEmbedder } from './embed'
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

export function createResolveDeps(baseDir: string, model?: string): ResolveDeps {
  const home = ensureIsolatedCopilotHome(baseDir)
  const embedder = createLocalEmbedder({ cacheDir: join(baseDir, 'model-cache') })
  return {
    decideRunner: createCopilotDecideRunner({ isolatedHome: home, cwd: home, model }),
    mcpRunner: createMcpRunner(),
    assembleOptions: { retriever: createDefaultRetriever(embedder) },
  }
}
