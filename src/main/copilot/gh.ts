/**
 * Shared helpers for the `gh agent-task` subprocess (list + launch).
 *
 * `gh agent-task` requires gh's own keyring OAuth token. When `GH_TOKEN` /
 * `GITHUB_TOKEN` are present in the environment, agent-task rejects them
 * ("requires an OAuth token"). We strip just those two variables for agent-task
 * calls so gh falls back to its keyring auth. In the shipped app these vars are
 * normally unset (Octokit auth is a separate PAT in safeStorage), so the strip
 * is a no-op there and a fix when they happen to be present.
 */

import { accessSync, constants } from 'fs'

/** Resolve the full path to the `gh` binary, checking common macOS install locations. */
export function resolveGhPath(): string {
  const candidates = [
    '/opt/homebrew/bin/gh',
    '/usr/local/bin/gh',
    '/usr/bin/gh',
  ]
  for (const p of candidates) {
    try {
      accessSync(p, constants.X_OK)
      return p
    } catch { /* not found, try next */ }
  }
  // Fall back to bare `gh` and hope it's on PATH
  return 'gh'
}

/**
 * Build the environment for an `agent-task` subprocess: the current env with
 * `GH_TOKEN` / `GITHUB_TOKEN` removed so gh uses its keyring OAuth token.
 */
export function agentTaskEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base }
  delete env['GH_TOKEN']
  delete env['GITHUB_TOKEN']
  return env
}
