import { spawn } from 'child_process'
import { accessSync, constants } from 'fs'

/**
 * The decide-stage adapter: spawns the Copilot CLI in non-interactive mode to
 * make a ranking decision over opaque candidate ids. It runs with NO tools and
 * NO MCP servers, so the CLI can only rank, never execute — it emits ids only
 * and the app maps them back to saved metadata. Command construction is treated
 * as part of the safety contract and is unit-tested; the raw output is validated
 * by the caller (recommend.ts) before the app acts on it.
 */

export interface DecideOptions {
  /** Optional model pin (defaults to Copilot's choice). */
  model?: string
  /** Wall-clock timeout in ms before the child is killed. Default 30_000. */
  timeoutMs?: number
  /** Isolated HOME so the user's global MCP servers/config don't load. */
  isolatedHome?: string
  /** Inert working directory (nothing to read/write). */
  cwd?: string
  /** Cap on captured stdout bytes; larger output is treated as bad output. */
  maxOutputBytes?: number
}

export const DEFAULT_DECIDE_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_OUTPUT_BYTES = 2_000_000

/**
 * Builds the Copilot CLI argv for a decide call. Pure and unit-tested: the
 * safety contract is that this NEVER grants tools and ALWAYS denies MCP + ask.
 */
export function buildDecideArgs(prompt: string, options: DecideOptions = {}): string[] {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--no-color',
    // Safety contract: no tools, no built-in MCP, no interactive stops.
    '--disable-builtin-mcps',
    '--no-ask-user',
  ]
  if (options.model !== undefined && options.model.trim().length > 0) {
    args.push('--model', options.model.trim())
  }
  return args
}

/** Flags that must NEVER appear in a decide call (asserted by tests + here). */
const FORBIDDEN_FLAGS = ['--allow-all-tools', '--allow-all', '--allow-tool', '--additional-mcp-config']

/** Throws if a decide argv was built with a tool-granting or MCP-attaching flag. */
export function assertDecideArgsSafe(args: string[]): void {
  for (const flag of args) {
    if (FORBIDDEN_FLAGS.some((f) => flag === f || flag.startsWith(`${f}=`))) {
      throw new Error(`Unsafe decide flag in argv: ${flag}`)
    }
  }
}

/**
 * Builds the decide subprocess env. Part of the safety contract: the child must
 * not inherit a parent bypass. We force the isolated Copilot HOME and strip env
 * vars that could silently grant all tools (`COPILOT_ALLOW_ALL`) or redirect the
 * config away from the isolated home (`COPILOT_HOME`).
 */
export function buildDecideEnv(
  options: DecideOptions,
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv }
  if (options.isolatedHome !== undefined) {
    env['HOME'] = options.isolatedHome
    // Don't let a parent COPILOT_HOME override the isolated config location.
    delete env['COPILOT_HOME']
  }
  // Never let a parent env var auto-grant all tools to the decide call.
  delete env['COPILOT_ALLOW_ALL']
  return env
}

/** Resolve the Copilot CLI path, checking common install locations. */
export function resolveCopilotPath(): string {
  const home = process.env['HOME'] ?? ''
  const candidates = [
    home ? `${home}/.local/bin/copilot` : '',
    '/opt/homebrew/bin/copilot',
    '/usr/local/bin/copilot',
    '/usr/bin/copilot',
  ].filter((p) => p.length > 0)
  for (const p of candidates) {
    try {
      accessSync(p, constants.X_OK)
      return p
    } catch {
      /* try next */
    }
  }
  return 'copilot'
}

// ── JSONL parsing (pure) ──────────────────────────────────────────────────────

interface AssistantMessageEvent {
  type: 'assistant.message'
  data?: { content?: unknown }
}

/**
 * Extracts the final assistant message text from Copilot's `--output-format json`
 * JSONL stream. Pure. Returns the last assistant.message content, or a reason
 * when the stream contained none / was unparseable.
 */
export function parseDecideOutput(jsonl: string): { ok: true; content: string } | { ok: false; reason: string } {
  const lines = jsonl.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  let lastContent: string | null = null

  for (const line of lines) {
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue // non-JSON line (defensive); skip
    }
    if (
      event !== null &&
      typeof event === 'object' &&
      (event as { type?: unknown }).type === 'assistant.message'
    ) {
      const content = (event as AssistantMessageEvent).data?.content
      if (typeof content === 'string') lastContent = content
    }
  }

  if (lastContent === null) return { ok: false, reason: 'no assistant message in output' }
  return { ok: true, content: lastContent }
}

// ── Subprocess (not run in CI; exercised via an injected runner in resolve) ────

export type DecideRunFailure = 'timeout' | 'connector_down' | 'model_bad_output'

export interface DecideRunResult {
  ok: boolean
  /** The extracted assistant message content, when ok. */
  content: string | null
  /** Set when !ok. */
  failure: DecideRunFailure | null
  reason: string | null
}

/**
 * A pluggable decide runner so resolve.ts can be tested offline. The production
 * implementation spawns the Copilot CLI; tests inject a fake.
 */
export interface DecideRunner {
  run(prompt: string): Promise<DecideRunResult>
}

/** Production decide runner: spawns the isolated, tool-less Copilot CLI. */
export function createCopilotDecideRunner(options: DecideOptions = {}): DecideRunner {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DECIDE_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES

  return {
    run(prompt: string): Promise<DecideRunResult> {
      const args = buildDecideArgs(prompt, options)
      assertDecideArgsSafe(args)

      const env = buildDecideEnv(options)

      return new Promise<DecideRunResult>((resolve) => {
        const child = spawn(resolveCopilotPath(), args, { env, cwd: options.cwd })
        let stdout = ''
        let overflowed = false
        let settled = false

        const finish = (result: DecideRunResult): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          try {
            child.kill()
          } catch {
            /* already gone */
          }
          resolve(result)
        }

        const timer = setTimeout(() => {
          finish({ ok: false, content: null, failure: 'timeout', reason: `decide timed out after ${timeoutMs}ms` })
        }, timeoutMs)

        child.stdout.on('data', (d: Buffer) => {
          if (overflowed) return
          stdout += d.toString()
          if (stdout.length > maxOutputBytes) {
            overflowed = true
            finish({ ok: false, content: null, failure: 'model_bad_output', reason: 'decide output exceeded cap' })
          }
        })
        child.on('error', (err) => {
          finish({ ok: false, content: null, failure: 'connector_down', reason: err.message })
        })
        child.on('close', (code) => {
          if (settled) return
          if (code !== 0) {
            finish({
              ok: false,
              content: null,
              failure: 'connector_down',
              reason: `copilot exited ${code ?? 'null'}`,
            })
            return
          }
          const parsed = parseDecideOutput(stdout)
          if (!parsed.ok) {
            finish({ ok: false, content: null, failure: 'model_bad_output', reason: parsed.reason })
            return
          }
          finish({ ok: true, content: parsed.content, failure: null, reason: null })
        })
      })
    },
  }
}
