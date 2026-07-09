import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))

vi.mock('./index', () => ({ getDb: vi.fn() }))

import { getDb } from './index'
import { runMigrations } from './migrate'
import { createProject, deleteProject } from './projects'
import { createRepoRule } from './notifications'
import { createRoutingRule, resolveProjectIdForRepo, resolveProjectIdByName } from './routing-rules'

let db: BunDb

beforeEach(() => {
  db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)
})

describe('resolveProjectIdForRepo', () => {
  it('resolves via an exact repo rule (repo rule wins)', () => {
    const p = createProject('Repo')
    createRepoRule('acme', 'widgets', p.id)
    expect(resolveProjectIdForRepo('acme', 'widgets')).toBe(p.id)
  })

  it('a repo rule pointing at a soft-deleted project resolves to the Inbox (does not fall through)', () => {
    const p = createProject('Dead')
    const other = createProject('Live')
    createRepoRule('acme', 'widgets', p.id)
    // A routing rule that WOULD match — must be ignored because the repo rule claims the repo.
    createRoutingRule({ action: 'route', projectId: other.id, matchRepoOwner: 'acme', matchRepoName: 'widgets' })
    deleteProject(p.id)
    expect(resolveProjectIdForRepo('acme', 'widgets')).toBeNull()
  })

  it('falls through to a routing rule when there is no repo rule', () => {
    const p = createProject('Routed')
    createRoutingRule({ action: 'route', projectId: p.id, matchRepoOwner: 'acme', matchRepoName: 'widgets' })
    expect(resolveProjectIdForRepo('acme', 'widgets')).toBe(p.id)
  })

  it('matches an org-scoped routing rule', () => {
    const p = createProject('Org')
    createRoutingRule({ action: 'route', projectId: p.id, matchOrg: 'acme' })
    expect(resolveProjectIdForRepo('acme', 'anything')).toBe(p.id)
  })

  it('matches a repo rule case-insensitively (GitHub owner/name are case-insensitive)', () => {
    const p = createProject('CaseRepo')
    createRepoRule('Acme', 'Widgets', p.id)
    expect(resolveProjectIdForRepo('acme', 'widgets')).toBe(p.id)
    expect(resolveProjectIdForRepo('ACME', 'WIDGETS')).toBe(p.id)
  })

  it('does NOT match a routing rule that also requires a type/reason (a bare repo has neither)', () => {
    const p = createProject('Typed')
    createRoutingRule({ action: 'route', projectId: p.id, matchRepoOwner: 'acme', matchRepoName: 'widgets', matchReason: 'review_requested' })
    expect(resolveProjectIdForRepo('acme', 'widgets')).toBeNull()
  })

  it('returns null (Inbox) when nothing matches', () => {
    createProject('Unrelated')
    expect(resolveProjectIdForRepo('nobody', 'nothing')).toBeNull()
  })

  it('ignores a routing rule to a soft-deleted project', () => {
    const p = createProject('Gone')
    createRoutingRule({ action: 'route', projectId: p.id, matchRepoOwner: 'acme', matchRepoName: 'widgets' })
    deleteProject(p.id)
    expect(resolveProjectIdForRepo('acme', 'widgets')).toBeNull()
  })
})

describe('resolveProjectIdByName', () => {
  it('matches case-insensitively', () => {
    const p = createProject('My Project')
    expect(resolveProjectIdByName('my project')).toBe(p.id)
  })

  it('returns null for an unknown name', () => {
    createProject('Something')
    expect(resolveProjectIdByName('nope')).toBeNull()
  })

  it('excludes soft-deleted projects', () => {
    const p = createProject('Doomed')
    deleteProject(p.id)
    expect(resolveProjectIdByName('Doomed')).toBeNull()
  })

  it('picks the lowest id on a duplicate-name tie', () => {
    const first = createProject('Dup')
    createProject('Dup')
    expect(resolveProjectIdByName('Dup')).toBe(first.id)
  })
})
