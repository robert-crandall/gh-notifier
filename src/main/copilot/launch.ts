/**
 * Launch a cloud `gh agent-task` and parse its result.
 *
 * `gh agent-task create` prints a single agent-session URL to stdout, e.g.
 *   https://github.com/OWNER/REPO/pull/73/agent-sessions/932fbdd1-...-3f874e
 * from which we extract the session UUID (the row id used across the app) and,
 * when present, the PR number + plain PR URL.
 */

import { spawn } from 'child_process'
import { resolveGhPath, agentTaskEnv } from './gh'
import type { LaunchAgentTaskPayload } from '../../shared/ipc-channels'

export interface ParsedAgentTaskCreate {
  /** The agent-task session UUID (used as the copilot_sessions row id). */
  sessionId: string
  /** The full agent-session URL printed by gh. */
  sessionUrl: string
  /** PR number when the URL includes `/pull/<n>/`, else null. */
  prNumber: number | null
  /** Plain PR URL (session URL minus the `/agent-sessions/...` suffix), else null. */
  prUrl: string | null
}

/** UUID (or other id) directly after `agent-sessions/`, up to a delimiter. */
const SESSION_ID_RE = /agent-sessions\/([^/?\s#]+)/
/** PR number in a `/pull/<n>` path segment. */
const PR_NUMBER_RE = /\/pull\/(\d+)(?:[/?#]|$)/

/**
 * Parse `gh agent-task create` stdout into its session id + PR bits. Pure.
 * Throws when no agent-session id can be found (unexpected output shape).
 */
export function parseAgentTaskCreateOutput(stdout: string): ParsedAgentTaskCreate {
  const trimmed = stdout.trim()
  // gh prints the URL on its own line; take the last non-empty line defensively.
  const line = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .pop() ?? ''

  const idMatch = SESSION_ID_RE.exec(line)
  if (idMatch === null || idMatch[1] === undefined) {
    throw new Error(`Could not parse agent-task session id from output: ${JSON.stringify(trimmed)}`)
  }
  const sessionId = idMatch[1]

  let prNumber: number | null = null
  let prUrl: string | null = null
  const prMatch = PR_NUMBER_RE.exec(line)
  if (prMatch !== null && prMatch[1] !== undefined) {
    prNumber = Number(prMatch[1])
    const suffixIdx = line.indexOf('/agent-sessions/')
    prUrl = suffixIdx !== -1 ? line.slice(0, suffixIdx) : null
  }

  return { sessionId, sessionUrl: line, prNumber, prUrl }
}

export interface NormalizedLaunch {
  prompt: string
  repoOwner: string
  repoName: string
  /** `owner/repo`. */
  repo: string
  baseBranch: string | null
}

/** Validate + normalize a launch payload. Pure. Throws `LAUNCH_FAILED: ...` on bad input. */
export function normalizeLaunchPayload(payload: LaunchAgentTaskPayload): NormalizedLaunch {
  const prompt = payload.prompt.trim()
  if (prompt.length === 0) throw new Error('LAUNCH_FAILED: a prompt is required')
  const repoOwner = payload.repoOwner.trim()
  const repoName = payload.repoName.trim()
  if (repoOwner.length === 0 || repoName.length === 0) {
    throw new Error('LAUNCH_FAILED: a target repository is required')
  }
  const baseBranch = payload.baseBranch?.trim() ? payload.baseBranch.trim() : null
  return { prompt, repoOwner, repoName, repo: `${repoOwner}/${repoName}`, baseBranch }
}

interface GhResult {
  stdout: string
  stderr: string
  code: number
}

/** Spawn gh with the given args, piping `stdin`, and collect stdio. */
function runGh(args: string[], stdin: string): Promise<GhResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveGhPath(), args, { env: agentTaskEnv() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('error', (err) => reject(err))
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }))
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

/**
 * Launch an agent task via `gh agent-task create`. The prompt is piped on stdin
 * (`-F -`) so arbitrary content — leading dashes, newlines, long text — is safe.
 * Runs in the main process, off the render thread.
 */
export async function launchAgentTask(payload: LaunchAgentTaskPayload): Promise<ParsedAgentTaskCreate> {
  const { prompt, repo, baseBranch } = normalizeLaunchPayload(payload)
  const args = ['agent-task', 'create', '-R', repo, '-F', '-']
  if (baseBranch !== null) args.push('-b', baseBranch)

  let result: GhResult
  try {
    result = await runGh(args, prompt)
  } catch (err) {
    throw new Error(`LAUNCH_FAILED: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }

  if (result.code !== 0) {
    const msg = result.stderr.trim()
    if (/OAuth token|auth login|not logged in|authentication/i.test(msg)) {
      throw new Error('GH_NOT_AUTHENTICATED')
    }
    throw new Error(`LAUNCH_FAILED: ${msg.length > 0 ? msg : `gh exited ${result.code}`}`)
  }

  return parseAgentTaskCreateOutput(result.stdout)
}
