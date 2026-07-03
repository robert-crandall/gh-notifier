/**
 * Trusted local-checkout resolver for desktop-app delegation.
 *
 * WS `create_session` needs a real on-disk `cwd`, but Focus only knows a repo as
 * `owner/repo`. Resolution (owner's confirmed UX — convention + override):
 *   1. a per-project explicit override path, if provided; else
 *   2. `<repos-root>/<repo>` (repos-root defaults to ~/repos, overridable).
 * The resolved path is only accepted when ALL strict checks hold:
 *   - it exists and is a directory;
 *   - it's inside a git worktree; and
 *   - a git remote NORMALIZES to the exact attempted `owner/repo`.
 * The remote check is what makes repo-name-only safe against owner collisions
 * (two different owners' `foo` won't both validate). Anything short of that →
 * unavailable → the caller falls back to cloud. We never infer a cwd from repo
 * metadata and never use the app's own cwd.
 */

import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const DEFAULT_REPOS_ROOT = '~/repos'

/** Expand a leading `~` / `~/…` to the user's home directory. Pure-ish (reads homedir). */
export function expandHome(p: string): string {
  const trimmed = p.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2))
  return trimmed
}

/**
 * Normalize a git remote URL to a lowercase `owner/repo`, or null if it doesn't
 * look like one. Handles https, `git@host:owner/repo`, and `ssh://` forms, with
 * or without a trailing `.git`. Host-agnostic (works for github.com + GHE).
 * Pure.
 */
export function normalizeRemoteToOwnerRepo(url: string): string | null {
  let s = url.trim()
  if (s.length === 0) return null
  // Trim trailing slashes FIRST, then drop a trailing `.git` (so `repo.git/`
  // normalizes correctly rather than leaving a stray `.git`).
  s = s.replace(/\/+$/, '').replace(/\.git$/i, '')

  // scp-like syntax: git@host:owner/repo
  const scp = /^[^/@]+@[^:/]+:(.+)$/.exec(s)
  if (scp !== null && scp[1] !== undefined) {
    return exactlyTwoSegments(scp[1])
  }
  // URL syntax: scheme://[user@]host/owner/repo
  const url2 = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/@]+@)?[^/]+\/(.+)$/i.exec(s)
  if (url2 !== null && url2[1] !== undefined) {
    return exactlyTwoSegments(url2[1])
  }
  // Bare path: owner/repo
  if (s.includes('/')) return exactlyTwoSegments(s)
  return null
}

/**
 * Return `owner/repo` (lowercased) ONLY when the path is EXACTLY two non-empty
 * segments. Empty segments are NOT filtered out, so a doubled/leading slash
 * (e.g. `//owner/repo` or `owner//repo`) is rejected rather than collapsed — a
 * checkout whose remote merely *ends* with the target owner/repo can't
 * false-validate as trusted. Pure.
 */
function exactlyTwoSegments(path: string): string | null {
  const parts = path.split('/')
  if (parts.length !== 2) return null
  const [owner, repo] = parts
  if (owner === undefined || owner.length === 0 || repo === undefined || repo.length === 0) return null
  return `${owner}/${repo}`.toLowerCase()
}

/** Do any of the remote URLs normalize to exactly `owner/repo` (case-insensitive)? Pure. */
export function remotesMatchRepo(remoteUrls: string[], owner: string, repo: string): boolean {
  const target = `${owner}/${repo}`.toLowerCase()
  return remoteUrls.some((u) => normalizeRemoteToOwnerRepo(u) === target)
}

// ── Injectable filesystem/git probes (real impls by default; faked in tests) ──

export interface GitInspection {
  insideWorkTree: boolean
  remoteUrls: string[]
}

/** Inspect a directory's git state. Returns insideWorkTree=false when not a repo. */
export type GitInspector = (dirPath: string) => Promise<GitInspection>

/** True when the path exists and is a directory. */
export type DirProbe = (dirPath: string) => boolean

const defaultDirProbe: DirProbe = (dirPath) => {
  try {
    return statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

/**
 * Real git inspection. Runs git ASYNC (promisified execFile) so it never blocks
 * the Electron main-process event loop — matching the rest of the codebase's
 * async subprocess pattern. A hung git can't freeze IPC (5s timeout per call).
 */
const defaultGitInspector: GitInspector = async (dirPath) => {
  const run = async (args: string[]): Promise<string | null> => {
    try {
      const { stdout } = await execFileAsync('git', ['-C', dirPath, ...args], { timeout: 5000 })
      return stdout
    } catch {
      return null
    }
  }
  const inside = await run(['rev-parse', '--is-inside-work-tree'])
  const insideWorkTree = inside !== null && inside.trim() === 'true'
  if (!insideWorkTree) return { insideWorkTree: false, remoteUrls: [] }

  const remotes = await run(['remote', '-v'])
  const remoteUrls: string[] = []
  if (remotes !== null) {
    for (const line of remotes.split(/\r?\n/)) {
      // "origin\thttps://github.com/owner/repo.git (fetch)"
      const m = /^\S+\s+(\S+)\s+\((?:fetch|push)\)/.exec(line.trim())
      if (m !== null && m[1] !== undefined) remoteUrls.push(m[1])
    }
  }
  return { insideWorkTree: true, remoteUrls }
}

export interface ResolveCwdOptions {
  /** Repos-root setting (raw; `~` expanded here). Defaults to ~/repos. */
  reposRoot?: string
  /** Per-project explicit override path (wins over the convention). */
  overridePath?: string | null
  dirProbe?: DirProbe
  gitInspector?: GitInspector
}

export type CwdResolution = { ok: true; cwd: string } | { ok: false; reason: 'no_local_cwd' }

/**
 * Resolve a trusted local checkout for `owner/repo`, or report that none is
 * available. See the module doc for the strict-validation contract. Async: the
 * git inspection runs off the main-thread event loop.
 */
export async function resolveLocalCwd(
  owner: string,
  repo: string,
  options: ResolveCwdOptions = {}
): Promise<CwdResolution> {
  const dirProbe = options.dirProbe ?? defaultDirProbe
  const gitInspector = options.gitInspector ?? defaultGitInspector

  const override = options.overridePath?.trim()
  const candidate =
    override !== undefined && override.length > 0
      ? expandHome(override)
      : join(expandHome(options.reposRoot?.trim() || DEFAULT_REPOS_ROOT), repo)

  // Must be an absolute directory that exists.
  if (!isAbsolute(candidate) || !dirProbe(candidate)) return { ok: false, reason: 'no_local_cwd' }

  const git = await gitInspector(candidate)
  if (!git.insideWorkTree) return { ok: false, reason: 'no_local_cwd' }
  if (!remotesMatchRepo(git.remoteUrls, owner, repo)) return { ok: false, reason: 'no_local_cwd' }

  return { ok: true, cwd: candidate }
}
