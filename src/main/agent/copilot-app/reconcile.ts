/**
 * Read-only reconciler for sessions the user opened DIRECTLY in the Copilot
 * desktop app (#119). It is the SOURCE OF TRUTH for a session's repo, because the
 * live WS `session_event` frame carries no cwd (confirmed in the spike) — only a
 * session id. We map each observed session to a project by reading the app's own
 * on-disk session store and upsert it tagged `observed`.
 *
 * Layout (UNOFFICIAL — treated as best-effort, contained entirely in this adapter):
 *   ~/.copilot/session-state/<session-id>/workspace.yaml  → { id, cwd, repository, name }
 * The DIRECTORY BASENAME is the canonical session id; when `workspace.yaml.id` is
 * present it must match, else the session is skipped (fail closed).
 *
 * Guarantees: never writes to any ~/.copilot file; never runs a subprocess in the
 * loop; the asserted `repository` is used ONLY for project mapping/display, never
 * for command execution or filesystem access. Bounds the full scan by recency +
 * cap so the thousands of historical session dirs don't churn each poll; the WS
 * observer catches old-but-active sessions via targeted `reconcileOne`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CopilotAppSession } from '../../../shared/ipc-channels'
import { resolveProjectId } from '../../copilot/resolve-project'
import { getAppSession, upsertObservedSession, type UpsertObservedSessionInput } from './store'
import { parseWorkspaceYaml, parseAssertedRepo, isValidSessionId } from './workspace-yaml'

/** Directory holding the desktop app's per-session state. */
export function sessionStateDir(): string {
  return join(homedir(), '.copilot', 'session-state')
}

/** Injectable filesystem probes (real impls by default; faked with fixtures in tests). */
export interface ReconcileFs {
  /** session-state child directories as { id: basename, mtimeMs }. */
  listSessions: () => { id: string; mtimeMs: number }[]
  /** A session's workspace.yaml text, or null when missing/unreadable. */
  readWorkspaceYaml: (id: string) => string | null
}

export interface ReconcileDeps {
  fs: ReconcileFs
  now: () => number
  resolveProject: (owner: string, repo: string) => number | null
  getExisting: (id: string) => CopilotAppSession | null
  upsertObserved: (input: UpsertObservedSessionInput) => CopilotAppSession
}

/** Why a session wasn't upserted as observed. */
export type ReconcileSkipReason =
  | 'invalid_id'   // dir name isn't a valid session id
  | 'id_mismatch'  // workspace.yaml.id disagrees with the dir name
  | 'no_cwd'       // no cwd in workspace.yaml (malformed / not a workspace session)
  | 'no_repo'      // no well-formed owner/repo asserted
  | 'unresolved'   // repo doesn't map to any live project — out of scope for #119
  | 'launched'     // already tracked as a Projects-launched session (never downgrade)

export type ReconcileOutcome =
  | { kind: 'missing' } // workspace.yaml not readable yet (may be a flush race — caller can retry)
  | { kind: 'skipped'; reason: ReconcileSkipReason }
  | { kind: 'upserted'; changed: boolean; session: CopilotAppSession }

export interface ReconcileSummary {
  scanned: number
  parsed: number
  skippedMalformed: number
  skippedNoRepo: number
  skippedUnresolved: number
  skippedLaunched: number
  upserted: number
  /** How many upserts actually changed a row (new, or project/title/cwd/repo moved). */
  changed: number
}

function emptySummary(): ReconcileSummary {
  return {
    scanned: 0,
    parsed: 0,
    skippedMalformed: 0,
    skippedNoRepo: 0,
    skippedUnresolved: 0,
    skippedLaunched: 0,
    upserted: 0,
    changed: 0,
  }
}

/** Pure-ish core: reconcile one session given its already-read workspace.yaml text. */
export function reconcileSession(id: string, yamlText: string | null, deps: ReconcileDeps): ReconcileOutcome {
  if (!isValidSessionId(id)) return { kind: 'skipped', reason: 'invalid_id' }
  if (yamlText === null) return { kind: 'missing' }

  const parsed = parseWorkspaceYaml(yamlText)
  // The dir basename is canonical; a present-but-different id is a red flag → skip.
  if (parsed.id !== null && parsed.id !== id) return { kind: 'skipped', reason: 'id_mismatch' }

  const cwd = parsed.cwd
  if (cwd === null) return { kind: 'skipped', reason: 'no_cwd' }

  // Never downgrade a Projects-launched session; it's already tracked with better provenance.
  const existing = deps.getExisting(id)
  if (existing !== null && existing.origin === 'launched') return { kind: 'skipped', reason: 'launched' }

  const repo = parseAssertedRepo(parsed.repository)
  if (repo === null) return { kind: 'skipped', reason: 'no_repo' }

  const projectId = deps.resolveProject(repo.owner, repo.repo)
  // Scope for #119: only observe sessions in a repo Projects already knows about.
  if (projectId === null) return { kind: 'skipped', reason: 'unresolved' }

  const title = parsed.name ?? `${repo.owner}/${repo.repo}`
  const session = deps.upsertObserved({
    id,
    projectId,
    cwd,
    title,
    repoOwner: repo.owner,
    repoName: repo.repo,
  })

  const changed =
    existing === null ||
    existing.projectId !== session.projectId ||
    existing.title !== session.title ||
    existing.cwd !== session.cwd ||
    existing.repoOwner !== session.repoOwner ||
    existing.repoName !== session.repoName
  return { kind: 'upserted', changed, session }
}

/** Fold a single outcome into a running summary. */
function tally(summary: ReconcileSummary, outcome: ReconcileOutcome): void {
  summary.scanned++
  switch (outcome.kind) {
    case 'missing':
      summary.skippedMalformed++
      return
    case 'skipped':
      if (outcome.reason === 'no_repo') summary.skippedNoRepo++
      else if (outcome.reason === 'unresolved') summary.skippedUnresolved++
      else if (outcome.reason === 'launched') summary.skippedLaunched++
      else summary.skippedMalformed++
      return
    case 'upserted':
      summary.parsed++
      summary.upserted++
      if (outcome.changed) summary.changed++
      return
  }
}

/** Reconcile a single session by id (targeted; NOT recency-bounded). */
export function reconcileOne(id: string, deps: ReconcileDeps): ReconcileOutcome {
  const yamlText = isValidSessionId(id) ? deps.fs.readWorkspaceYaml(id) : null
  return reconcileSession(id, yamlText, deps)
}

export interface ReconcileRecentOptions {
  /** Only scan sessions whose dir mtime is within this window. Default 45 days. */
  maxAgeMs?: number
  /** Hard cap on sessions scanned per pass (most-recent first). Default 500. */
  cap?: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULTS: Required<ReconcileRecentOptions> = { maxAgeMs: 45 * DAY_MS, cap: 500 }

/**
 * Full reconcile of RECENT session dirs — the startup + periodic backstop. Bounds
 * work by recency + cap (most-recent first) so historical dirs don't churn.
 * Returns a token-safe summary (no ids/paths) for fail-closed diagnostics.
 */
export function reconcileRecent(deps: ReconcileDeps, options: ReconcileRecentOptions = {}): ReconcileSummary {
  const maxAgeMs = options.maxAgeMs ?? DEFAULTS.maxAgeMs
  const cap = options.cap ?? DEFAULTS.cap
  const summary = emptySummary()

  const cutoff = deps.now() - maxAgeMs
  const recent = deps.fs
    .listSessions()
    .filter((s) => s.mtimeMs >= cutoff)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, cap)

  for (const { id } of recent) {
    tally(summary, reconcileOne(id, deps))
  }
  return summary
}

/** Real filesystem probes over ~/.copilot/session-state (read-only). */
export function createReconcileFs(dir: string = sessionStateDir()): ReconcileFs {
  return {
    listSessions: () => {
      let entries: import('node:fs').Dirent[]
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return [] // session-state missing → app never ran / different layout
      }
      const out: { id: string; mtimeMs: number }[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        try {
          out.push({ id: entry.name, mtimeMs: statSync(join(dir, entry.name)).mtimeMs })
        } catch {
          /* vanished between readdir and stat — skip */
        }
      }
      return out
    },
    readWorkspaceYaml: (id) => {
      try {
        return readFileSync(join(dir, id, 'workspace.yaml'), 'utf8')
      } catch {
        return null // not yet flushed / missing / unreadable
      }
    },
  }
}

/** Production wiring for the reconciler. */
export function createReconcileDeps(): ReconcileDeps {
  return {
    fs: createReconcileFs(),
    now: () => Date.now(),
    resolveProject: (owner, repo) => resolveProjectId(owner, repo),
    getExisting: (id) => getAppSession(id),
    upsertObserved: (input) => upsertObservedSession(input),
  }
}

/** Token-safe one-line summary for logs (no ids, paths, or repo names). */
export function formatReconcileSummary(s: ReconcileSummary): string {
  return (
    `scanned=${s.scanned} upserted=${s.upserted} changed=${s.changed} ` +
    `skipped(malformed=${s.skippedMalformed} no_repo=${s.skippedNoRepo} ` +
    `unresolved=${s.skippedUnresolved} launched=${s.skippedLaunched})`
  )
}
