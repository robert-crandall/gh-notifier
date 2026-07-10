/**
 * On-disk store for per-service knowledge runbooks (issue #100). All filesystem
 * I/O lives here (off the render thread), so both the MCP tools and the app IPC
 * go through one place — which is where the safety and recoverability guarantees
 * are enforced:
 *
 *   - SECURITY: the service name is validated to a safe slug (shared validator)
 *     AND the resolved path is re-checked to stay inside the knowledge dir; reads
 *     and overwrites refuse to follow a symlinked runbook or a symlinked history
 *     dir, so a write can never escape `~/.gh-projects/knowledge/`.
 *   - UNGATED BUT RECOVERABLE: every overwrite first copies the prior file to a
 *     uniquely-named `.history/<service>/<ts>.md` backup (created exclusively);
 *     the write is aborted if that backup fails. History is pruned to the most
 *     recent N versions.
 *   - CONSISTENT: writes are atomic (temp file + rename) and serialized per
 *     service, so concurrent writes can't corrupt a file or lose a backup, and a
 *     concurrent reader always sees a whole old-or-new file (never a torn one).
 *   - BOUNDED: writes over `KNOWLEDGE_MAX_BYTES` are rejected; a hand-edited file
 *     over that size reads back as `too_large` rather than being silently
 *     truncated downstream.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { validateServiceName } from '../../shared/service-name'
import type { KnowledgeFrontmatter } from './frontmatter'
import { emitKnowledge, parseKnowledge } from './frontmatter'
import { historyDir, knowledgeDir } from './paths'

/** Max runbook size (bytes). Comfortably fits a long runbook; bounds pathological input. */
export const KNOWLEDGE_MAX_BYTES = 256 * 1024

/** How many historical backups to keep per service. Older ones are pruned. */
export const MAX_HISTORY_VERSIONS = 20

/** Structured `source` values we stamp/understand. Humans may write anything. */
export type KnowledgeSource = 'user' | 'copilot'

/** A read runbook. `markdown` is the file's exact bytes; the rest is parsed metadata. */
export interface ServiceKnowledge {
  service: string
  markdown: string
  frontmatter: KnowledgeFrontmatter
  env: string | null
  updatedAt: string | null
  source: string | null
  /** Absolute path on disk (for reveal-in-Finder). */
  path: string
}

export type ReadResult =
  | { status: 'ok'; knowledge: ServiceKnowledge }
  | { status: 'missing'; service: string; path: string }
  | { status: 'too_large'; service: string; size: number }
  | { status: 'invalid_service'; reason: string }
  | { status: 'blocked'; reason: string }

export type WriteResult =
  | { status: 'ok'; service: string; path: string; backedUp: boolean; updatedAt: string }
  | { status: 'too_large'; service: string; size: number }
  | { status: 'invalid_service'; reason: string }
  | { status: 'blocked'; reason: string }
  | { status: 'backup_failed'; reason: string }

// ── Path safety ───────────────────────────────────────────────────────────────

/**
 * Resolve `<dir>/<key>.md` and re-assert it stays within `dir` (defense-in-depth
 * behind the slug validator). Returns null if containment somehow fails.
 */
function safeServiceFilePath(dir: string, key: string): string | null {
  const base = resolve(dir)
  const full = resolve(base, `${key}.md`)
  if (full !== `${base}${sep}${key}.md`) return null
  return full
}

/**
 * Public helper for callers that just need the on-disk path for a service (e.g.
 * reveal-in-Finder). Returns null for an invalid/unsafe service name.
 */
export function knowledgeFilePathForService(service: string, dir: string = knowledgeDir()): string | null {
  const v = validateServiceName(service)
  if (!v.ok) return null
  return safeServiceFilePath(dir, v.key)
}

/**
 * Path to a service's runbook only when it exists as a real (non-symlink) file —
 * for reveal-in-Finder. Returns null when the name is invalid, the file is
 * missing, or the path is a symlink.
 */
export function revealablePathForService(service: string, dir: string = knowledgeDir()): string | null {
  const path = knowledgeFilePathForService(service, dir)
  if (path === null) return null
  try {
    const st = lstatSync(path)
    if (st.isSymbolicLink() || !st.isFile()) return null
    return path
  } catch {
    return null
  }
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * Read a service's runbook fresh from disk (so out-of-band human edits are always
 * seen). Refuses to follow a symlink; reports missing / oversized explicitly.
 */
export function readServiceKnowledge(service: string, dir: string = knowledgeDir()): ReadResult {
  const v = validateServiceName(service)
  if (!v.ok) return { status: 'invalid_service', reason: v.reason }
  const key = v.key
  const filePath = safeServiceFilePath(dir, key)
  if (filePath === null) return { status: 'blocked', reason: 'Resolved path escaped the knowledge directory.' }

  let st: ReturnType<typeof lstatSync>
  try {
    st = lstatSync(filePath) // lstat: does NOT follow a symlink
  } catch {
    return { status: 'missing', service: key, path: filePath }
  }
  if (st.isSymbolicLink()) return { status: 'blocked', reason: 'Refusing to follow a symlinked runbook.' }
  if (!st.isFile()) return { status: 'missing', service: key, path: filePath }
  if (st.size > KNOWLEDGE_MAX_BYTES) return { status: 'too_large', service: key, size: st.size }

  const markdown = readFileSync(filePath, 'utf8')
  const parsed = parseKnowledge(markdown)
  return {
    status: 'ok',
    knowledge: {
      service: key,
      markdown,
      frontmatter: parsed.frontmatter,
      env: parsed.frontmatter.env,
      updatedAt: parsed.frontmatter.updatedAt,
      source: parsed.frontmatter.source,
      path: filePath,
    },
  }
}

// ── Writes (serialized per service) ───────────────────────────────────────────

/**
 * Per-service write queue. All writes for a given key run strictly one after the
 * other so backups, prunes, and the atomic rename can't interleave. Bounded by
 * the (small) number of distinct services.
 */
const writeChains = new Map<string, Promise<unknown>>()

function serializeWrite<T>(key: string, op: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(key) ?? Promise.resolve()
  const run = prev.then(op, op) // run regardless of the previous op's outcome
  const tail = run.then(
    () => {},
    () => {}
  )
  writeChains.set(key, tail)
  // Drop the entry once this tail settles, UNLESS a newer write already chained
  // onto it (in which case that newer tail is now stored and owns cleanup). This
  // keeps the map bounded even if many distinct services are written over time,
  // while preserving strict per-service serialization.
  void tail.finally(() => {
    if (writeChains.get(key) === tail) writeChains.delete(key)
  })
  return run
}

/** Monotonic per-process counter to keep backup filenames unique within a ms. */
let backupCounter = 0

/** Test/inspection helper: number of services with a live (pending) write chain. */
export function pendingWriteChainCount(): number {
  return writeChains.size
}

/** Filesystem-safe timestamp for backup filenames (no `:` / `.`). */
function backupStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** mkdir a real directory, returning false (never throwing) on any failure — a
 * symlinked path, a non-directory in the way, or a permission/IO error — so
 * callers always get a controlled result instead of an exception. */
function ensureRealDir(dirPath: string): boolean {
  try {
    mkdirSync(dirPath, { recursive: true, mode: 0o700 })
    return !lstatSync(dirPath).isSymbolicLink()
  } catch {
    return false
  }
}

/** Copy `content` into `.history/<key>/<stamp>.md` (exclusive create), then prune. */
function backupBuffer(dir: string, key: string, content: Buffer): void {
  const hRoot = historyDir(dir)
  if (!ensureRealDir(hRoot)) throw new Error('history directory is a symlink or unwritable')
  const hDir = join(hRoot, key)
  if (!ensureRealDir(hDir)) throw new Error('service history directory is a symlink or unwritable')
  const name = `${backupStamp()}-${backupCounter++}.md`
  writeFileSync(join(hDir, name), content, { flag: 'wx', mode: 0o600 })
  pruneHistory(hDir)
}

/** Keep only the most recent MAX_HISTORY_VERSIONS backups (by mtime). */
function pruneHistory(hDir: string): void {
  let entries: string[]
  try {
    entries = readdirSync(hDir).filter((n) => n.endsWith('.md'))
  } catch {
    return
  }
  if (entries.length <= MAX_HISTORY_VERSIONS) return
  const withTime = entries.map((name) => {
    const p = join(hDir, name)
    let mtimeMs = 0
    try {
      mtimeMs = statSync(p).mtimeMs
    } catch {
      /* treat as oldest */
    }
    return { p, mtimeMs }
  })
  withTime.sort((a, b) => b.mtimeMs - a.mtimeMs) // newest first
  for (const { p } of withTime.slice(MAX_HISTORY_VERSIONS)) {
    try {
      rmSync(p, { force: true })
    } catch {
      /* best-effort */
    }
  }
}

/** Atomically write `content` to `filePath` via an exclusive temp file + rename. */
function atomicWriteFile(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  renameSync(tmp, filePath)
}

export interface WriteInput {
  service: string
  markdown: string
  /** Structured source stamp. Defaults to 'copilot' (the ungated MCP write path). */
  source?: KnowledgeSource
}

/**
 * Write a service's runbook straight through (ungated). Stamps `service`,
 * `updated_at`, and `source`, preserves a human's `env` when the incoming
 * markdown doesn't set one, backs up any prior version first, and writes
 * atomically. Serialized per service.
 */
export function writeServiceKnowledge(input: WriteInput, dir: string = knowledgeDir()): Promise<WriteResult> {
  const { service, markdown, source = 'copilot' } = input
  const v = validateServiceName(service)
  if (!v.ok) return Promise.resolve({ status: 'invalid_service', reason: v.reason })
  const key = v.key

  const bytes = Buffer.byteLength(markdown, 'utf8')
  if (bytes > KNOWLEDGE_MAX_BYTES) {
    return Promise.resolve({ status: 'too_large', service: key, size: bytes })
  }

  return serializeWrite(key, async (): Promise<WriteResult> => {
    if (!ensureRealDir(dir)) return { status: 'blocked', reason: 'Could not prepare the knowledge directory (it may be a symlink or unwritable).' }
    const filePath = safeServiceFilePath(dir, key)
    if (filePath === null) return { status: 'blocked', reason: 'Resolved path escaped the knowledge directory.' }

    // Inspect any existing file: reject a symlink, capture its bytes for backup +
    // its env for the metadata merge.
    let existing: Buffer | null = null
    if (existsSync(filePath)) {
      let st: ReturnType<typeof lstatSync>
      try {
        st = lstatSync(filePath)
      } catch {
        return { status: 'blocked', reason: 'Could not stat the existing runbook.' }
      }
      if (st.isSymbolicLink()) return { status: 'blocked', reason: 'Refusing to overwrite a symlinked runbook.' }
      if (!st.isFile()) return { status: 'blocked', reason: 'A non-file exists at the runbook path.' }
      existing = readFileSync(filePath)
    }

    const existingEnv = existing !== null ? parseKnowledge(existing.toString('utf8')).frontmatter.env : null

    // Build the stamped content first: force service/source/updated_at; preserve
    // env unless the incoming markdown explicitly supplies one. Re-check the FINAL
    // size (stamped frontmatter adds bytes) so we never write a file the read path
    // would then reject as too_large — and reject BEFORE taking a backup.
    const parsedIncoming = parseKnowledge(markdown)
    const env = parsedIncoming.frontmatter.env ?? existingEnv
    const updatedAt = new Date().toISOString()
    const frontmatter: KnowledgeFrontmatter = { service: key, env, updatedAt, source }
    const content = emitKnowledge(frontmatter, parsedIncoming.body)
    const finalBytes = Buffer.byteLength(content, 'utf8')
    if (finalBytes > KNOWLEDGE_MAX_BYTES) return { status: 'too_large', service: key, size: finalBytes }

    // Recoverability: back up the prior version BEFORE overwriting. Abort on failure.
    let backedUp = false
    if (existing !== null) {
      try {
        backupBuffer(dir, key, existing)
        backedUp = true
      } catch (err) {
        return { status: 'backup_failed', reason: err instanceof Error ? err.message : 'backup failed' }
      }
    }

    atomicWriteFile(filePath, content)
    return { status: 'ok', service: key, path: filePath, backedUp, updatedAt }
  })
}

// ── History inspection (tests / recovery) ─────────────────────────────────────

/** Absolute paths of a service's backups, newest first. Empty when none. */
export function listServiceHistory(service: string, dir: string = knowledgeDir()): string[] {
  const v = validateServiceName(service)
  if (!v.ok) return []
  const hDir = join(historyDir(dir), v.key)
  let entries: string[]
  try {
    entries = readdirSync(hDir).filter((n) => n.endsWith('.md'))
  } catch {
    return []
  }
  return entries
    .map((name) => join(hDir, name))
    .map((p) => ({ p, mtimeMs: safeMtime(p) }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map(({ p }) => p)
}

function safeMtime(p: string): number {
  try {
    return statSync(p).mtimeMs
  } catch {
    return 0
  }
}
