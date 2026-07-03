import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpStdioConfig } from '../../shared/ipc-channels'

/**
 * The app-owned MCP read (two-stage resolver, stage three: RUN). After the
 * untrusted Copilot decide call cites a candidate, the app itself executes that
 * candidate's stored tool call here via its own MCP client and owns the raw
 * result. A live value is ONLY ever produced by this code — never self-reported
 * by Copilot. Failures classify into bad-source (query_invalid/no_data) vs
 * bad-infra (auth_missing/connector_down/timeout) so only bad sources are
 * marked suspect.
 */

export type McpFailureClass = 'query_invalid' | 'no_data' | 'auth_missing' | 'connector_down' | 'timeout'

export interface McpRunResult {
  ok: boolean
  /** The app-owned live value (tool text output), when ok. */
  value: string | null
  failure: McpFailureClass | null
  reason: string | null
}

export interface McpRunner {
  run(server: McpStdioConfig, toolName: string, toolArgs: Record<string, unknown>): Promise<McpRunResult>
}

export const DEFAULT_MCP_TIMEOUT_MS = 20_000

// ── Pure result interpretation (unit-tested without spawning) ─────────────────

interface ToolTextBlock {
  type: string
  text?: unknown
}

/** Extracts joined text from an MCP callTool result's content blocks. Pure. */
export function extractToolText(result: unknown): string {
  if (result === null || typeof result !== 'object') return ''
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is ToolTextBlock => b !== null && typeof b === 'object' && (b as ToolTextBlock).type === 'text')
    .map((b) => (typeof b.text === 'string' ? b.text : ''))
    .join('\n')
    .trim()
}

/** True when the raw result signalled a tool-level error. Pure. */
function isToolError(result: unknown): boolean {
  return result !== null && typeof result === 'object' && (result as { isError?: unknown }).isError === true
}

/** Maps a bad-tool-result message to a source failure class. */
function classifyToolError(text: string): Extract<McpFailureClass, 'query_invalid' | 'auth_missing'> {
  if (/unauthor|forbidden|401|403|auth|permission denied|access denied/i.test(text)) return 'auth_missing'
  return 'query_invalid'
}

/**
 * Interprets a raw callTool result into an McpRunResult. Pure so the mapping
 * (ok / no_data / query_invalid / auth_missing) is exhaustively testable without
 * spawning a server.
 */
export function interpretCallResult(result: unknown): McpRunResult {
  const text = extractToolText(result)
  if (isToolError(result)) {
    const failure = classifyToolError(text)
    return { ok: false, value: null, failure, reason: text || 'tool reported an error' }
  }
  if (text.length === 0) {
    return { ok: false, value: null, failure: 'no_data', reason: 'tool returned no data' }
  }
  return { ok: true, value: text, failure: null, reason: null }
}

// ── Production runner (spawns the app-owned MCP client) ────────────────────────

export interface McpRunnerOptions {
  timeoutMs?: number
}

/** Runs a promise against a wall-clock deadline, resolving to a timeout result. */
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(onTimeout()), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

/**
 * Production MCP runner: connects to the (user/app-approved) stdio MCP server,
 * calls the stored tool, and owns the raw result. Config comes only from the
 * per-project MCP config — never from repo-supplied commands.
 */
export function createMcpRunner(options: McpRunnerOptions = {}): McpRunner {
  const timeoutMs = options.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS

  return {
    async run(server, toolName, toolArgs): Promise<McpRunResult> {
      // Ensure the child can find its command; merge PATH but keep the approved env.
      const env: Record<string, string> = {}
      if (typeof process.env.PATH === 'string') env.PATH = process.env.PATH
      for (const [k, v] of Object.entries(server.env)) env[k] = v

      const transport = new StdioClientTransport({ command: server.command, args: server.args, env })
      const client = new Client({ name: 'gh-projects-resolver', version: '1.0.0' }, { capabilities: {} })

      let timedOut = false
      try {
        const result = await withTimeout(
          (async (): Promise<McpRunResult> => {
            await client.connect(transport)
            const raw = await client.callTool({ name: toolName, arguments: toolArgs })
            return interpretCallResult(raw)
          })(),
          timeoutMs,
          (): McpRunResult => {
            timedOut = true
            return { ok: false, value: null, failure: 'timeout', reason: `MCP read timed out after ${timeoutMs}ms` }
          }
        )
        return result
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        return { ok: false, value: null, failure: 'connector_down', reason }
      } finally {
        try {
          await client.close()
        } catch {
          /* best-effort close */
        }
        if (timedOut) {
          try {
            await transport.close()
          } catch {
            /* best-effort */
          }
        }
      }
    },
  }
}
