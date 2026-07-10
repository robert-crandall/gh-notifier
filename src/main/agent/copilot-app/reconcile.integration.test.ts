import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))

vi.mock('../../db', () => ({ getDb: vi.fn() }))

import { getDb } from '../../db'
import { runMigrations } from '../../db/migrate'
import { resolveProjectId } from '../../copilot/resolve-project'
import { getAppSession, upsertObservedSession, insertAppSession } from './store'
import {
  reconcileRecent,
  reconcileOne,
  type ReconcileDeps,
  type ReconcileFs,
} from './reconcile'

let db: BunDb

beforeEach(() => {
  db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)
})

function makeProject(name: string): number {
  return (db.prepare('INSERT INTO projects (name) VALUES (?) RETURNING id').get(name) as { id: number }).id
}
function mapRepo(owner: string, name: string, projectId: number): void {
  db.prepare('INSERT INTO repo_rules (repo_owner, repo_name, project_id) VALUES (?, ?, ?)').run(owner, name, projectId)
}

/** A fake session-state fs backed by an in-memory map of id → workspace.yaml text. */
function fakeFs(files: Record<string, { mtimeMs: number; yaml: string | null }>): ReconcileFs {
  return {
    listSessions: () => Object.entries(files).map(([id, f]) => ({ id, mtimeMs: f.mtimeMs })),
    readWorkspaceYaml: (id) => files[id]?.yaml ?? null,
  }
}

function deps(fs: ReconcileFs, now = 1_000_000): ReconcileDeps {
  return {
    fs,
    now: () => now,
    resolveProject: (owner, repo) => resolveProjectId(owner, repo),
    getExisting: (id) => getAppSession(id),
    upsertObserved: (input) => upsertObservedSession(input),
  }
}

function yamlFor(id: string, cwd: string, repository: string, name?: string): string {
  const lines = [`id: ${id}`, `cwd: ${cwd}`, `repository: ${repository}`]
  if (name !== undefined) lines.push(`name: '${name}'`)
  return lines.join('\n')
}

describe('reconcile — cwd→repo→project→observed ingest', () => {
  it('ingests a directly-opened session in a known repo as an observed row', () => {
    const pid = makeProject('Notifier')
    mapRepo('robert-crandall', 'gh-notifier', pid)
    const fs = fakeFs({
      's1': { mtimeMs: 999_999, yaml: yamlFor('s1', '/repos/gh-notifier', 'robert-crandall/gh-notifier', 'Fix the bug') },
    })

    const summary = reconcileRecent(deps(fs))
    expect(summary.upserted).toBe(1)
    expect(summary.changed).toBe(1)

    const s = getAppSession('s1')
    expect(s).not.toBeNull()
    expect(s?.origin).toBe('observed')
    expect(s?.projectId).toBe(pid)
    expect(s?.repoOwner).toBe('robert-crandall')
    expect(s?.repoName).toBe('gh-notifier')
    expect(s?.cwd).toBe('/repos/gh-notifier')
    expect(s?.title).toBe('Fix the bug')
  })

  it('skips a session whose repo maps to no project (out of scope for #119)', () => {
    const fs = fakeFs({ 's1': { mtimeMs: 999_999, yaml: yamlFor('s1', '/repos/unknown', 'someone/unknown') } })
    const summary = reconcileRecent(deps(fs))
    expect(summary.skippedUnresolved).toBe(1)
    expect(summary.upserted).toBe(0)
    expect(getAppSession('s1')).toBeNull()
  })

  it('skips a session with no well-formed repository', () => {
    const fs = fakeFs({ 's1': { mtimeMs: 999_999, yaml: 'id: s1\ncwd: /repos/x' } })
    const summary = reconcileRecent(deps(fs))
    expect(summary.skippedNoRepo).toBe(1)
    expect(getAppSession('s1')).toBeNull()
  })

  it('skips a malformed file with no cwd', () => {
    const fs = fakeFs({ 's1': { mtimeMs: 999_999, yaml: 'repository: a/b' } })
    const summary = reconcileRecent(deps(fs))
    expect(summary.skippedMalformed).toBe(1)
    expect(getAppSession('s1')).toBeNull()
  })

  it('skips (id_mismatch) when workspace.yaml.id disagrees with the dir name', () => {
    const pid = makeProject('P')
    mapRepo('a', 'b', pid)
    const fs = fakeFs({ 'dir-id': { mtimeMs: 999_999, yaml: yamlFor('OTHER-id', '/x', 'a/b') } })
    const summary = reconcileRecent(deps(fs))
    expect(summary.skippedMalformed).toBe(1)
    expect(getAppSession('dir-id')).toBeNull()
  })

  it('NEVER downgrades a Projects-launched session to observed', () => {
    const pid = makeProject('P')
    mapRepo('a', 'b', pid)
    insertAppSession({ id: 's1', projectId: pid, cwd: '/x', title: 'launched', repoOwner: 'a', repoName: 'b' })
    const fs = fakeFs({ 's1': { mtimeMs: 999_999, yaml: yamlFor('s1', '/x', 'a/b') } })

    const summary = reconcileRecent(deps(fs))
    expect(summary.skippedLaunched).toBe(1)
    expect(getAppSession('s1')?.origin).toBe('launched')
    expect(getAppSession('s1')?.title).toBe('launched') // untouched
  })

  it('full scan is recency-bounded, but reconcileOne ingests an old-but-active session', () => {
    const pid = makeProject('P')
    mapRepo('a', 'b', pid)
    const old = 1_000_000 - 100 * 24 * 60 * 60 * 1000 // 100 days old
    const fs = fakeFs({ 'old': { mtimeMs: old, yaml: yamlFor('old', '/x', 'a/b') } })

    // The periodic full scan skips it (too old to be in the window).
    expect(reconcileRecent(deps(fs)).scanned).toBe(0)
    expect(getAppSession('old')).toBeNull()

    // But a targeted reconcile (triggered by a live WS event) ingests it regardless of age.
    const outcome = reconcileOne('old', deps(fs))
    expect(outcome.kind).toBe('upserted')
    expect(getAppSession('old')?.projectId).toBe(pid)
  })

  it('reconcileOne reports missing when workspace.yaml is not yet flushed', () => {
    const fs = fakeFs({ 's1': { mtimeMs: 999_999, yaml: null } })
    expect(reconcileOne('s1', deps(fs)).kind).toBe('missing')
  })

  it('re-reconcile keeps a sticky manual pin instead of drifting', () => {
    const projA = makeProject('A')
    const projB = makeProject('B')
    mapRepo('a', 'b', projA) // repo resolves to A
    const fs = fakeFs({ 's1': { mtimeMs: 999_999, yaml: yamlFor('s1', '/x', 'a/b') } })
    reconcileRecent(deps(fs))
    expect(getAppSession('s1')?.projectId).toBe(projA)

    // User manually pins it to B (sticky).
    db.prepare('UPDATE copilot_app_sessions SET project_id = ?, pinned_project_id = ? WHERE id = ?').run(projB, projB, 's1')

    // Next reconcile still resolves the repo to A, but the sticky pin to B wins.
    reconcileRecent(deps(fs))
    expect(getAppSession('s1')?.projectId).toBe(projB)
  })

  it('reports no change on a re-reconcile that changes nothing', () => {
    const pid = makeProject('P')
    mapRepo('a', 'b', pid)
    const fs = fakeFs({ 's1': { mtimeMs: 999_999, yaml: yamlFor('s1', '/x', 'a/b', 'title') } })
    expect(reconcileRecent(deps(fs)).changed).toBe(1)
    expect(reconcileRecent(deps(fs)).changed).toBe(0)
  })
})
