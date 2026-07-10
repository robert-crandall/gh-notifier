import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'
import type { CopilotSession } from '../../shared/ipc-channels'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))

vi.mock('../db', () => ({ getDb: vi.fn() }))

import { getDb } from '../db'
import { runMigrations } from '../db/migrate'
import {
  upsertSessions,
  insertLaunchedSession,
  getSessionsForProject,
  getUnassignedSessions,
  getUnassignedActiveCount,
  assignSession,
  getRepoRuleSuggestionForSession,
} from './db'
import { getLaunchTargets } from './launch-targets'
import { resolveProjectId } from './resolve-project'
import { createRepoRule, listRepoRules } from '../db/notifications'
import { deleteProject } from '../db/projects'
import { getDigest } from '../digest'

let db: BunDb

beforeEach(() => {
  db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)
})

function makeProject(name: string): number {
  const row = db.prepare('INSERT INTO projects (name) VALUES (?) RETURNING id').get(name) as { id: number }
  return row.id
}

/** A synced CopilotSession as produced by the github source's mapRow. */
function syncedSession(overrides: Partial<CopilotSession>): CopilotSession {
  return {
    id: 's1',
    projectId: null,
    source: 'github',
    status: 'in_progress',
    title: 'Synced title',
    htmlUrl: null,
    startedAt: '2026-07-02T00:00:00Z',
    updatedAt: '2026-07-02T00:00:00Z',
    repoOwner: 'o',
    repoName: 'r',
    branch: null,
    linkedPrUrl: null,
    pinnedProjectId: null,
    ...overrides,
  }
}

describe('pinned project stickiness', () => {
  it('a launched session stays on its project when a later sync resolves to null', () => {
    const p = makeProject('P')
    insertLaunchedSession({
      id: 's1', title: 'Fix it', repoOwner: 'o', repoName: 'r',
      htmlUrl: 'https://x/pull/1', linkedPrUrl: 'https://x/pull/1', projectId: p,
    })

    // Sync sees the task but can't resolve a project (no thread/rule yet).
    upsertSessions([syncedSession({ id: 's1', projectId: null, status: 'pr_ready' })])

    const forProject = getSessionsForProject(p)
    expect(forProject.map((s) => s.id)).toContain('s1')
    expect(forProject[0].pinnedProjectId).toBe(p)
    expect(forProject[0].status).toBe('pr_ready') // volatile field followed sync
    expect(getUnassignedSessions().map((s) => s.id)).not.toContain('s1')
  })

  it('an unpinned session follows re-resolution across syncs', () => {
    const p2 = makeProject('P2')
    upsertSessions([syncedSession({ id: 's2', projectId: null })])
    expect(getUnassignedSessions().map((s) => s.id)).toContain('s2')

    upsertSessions([syncedSession({ id: 's2', projectId: p2 })])
    expect(getSessionsForProject(p2).map((s) => s.id)).toContain('s2')
    expect(getUnassignedSessions().map((s) => s.id)).not.toContain('s2')
  })

  it('optimistic launch UPSERT does not clobber an already-synced row', () => {
    const p = makeProject('P')
    // Sync created the row first (race): pr_ready with the real title.
    upsertSessions([syncedSession({ id: 's3', projectId: null, status: 'pr_ready', title: 'Real title' })])
    // Launch insert lands after — it should only pin, not downgrade status/title.
    insertLaunchedSession({
      id: 's3', title: 'Optimistic prompt', repoOwner: 'o', repoName: 'r',
      htmlUrl: null, linkedPrUrl: null, projectId: p,
    })

    const forProject = getSessionsForProject(p)
    expect(forProject).toHaveLength(1)
    expect(forProject[0].status).toBe('pr_ready')
    expect(forProject[0].title).toBe('Real title')
    expect(forProject[0].pinnedProjectId).toBe(p)
  })
})

describe('getUnassignedSessions / getUnassignedActiveCount', () => {
  it('returns active-first, includes completed, and excludes assigned', () => {
    makeProject('P')
    upsertSessions([
      syncedSession({ id: 'done', projectId: null, status: 'completed', updatedAt: '2026-07-02T10:00:00Z' }),
      syncedSession({ id: 'active', projectId: null, status: 'in_progress', updatedAt: '2026-07-02T09:00:00Z' }),
      syncedSession({ id: 'assigned', projectId: 1, status: 'in_progress' }),
    ])

    const ids = getUnassignedSessions().map((s) => s.id)
    expect(ids).toEqual(['active', 'done']) // active sorts first despite older timestamp
    expect(ids).not.toContain('assigned')
    expect(getUnassignedActiveCount()).toBe(1)
  })
})

describe('assignSession', () => {
  it('pins a session to a project and survives a later sync', () => {
    const p = makeProject('P')
    upsertSessions([syncedSession({ id: 's1', projectId: null })])
    assignSession('s1', p)

    expect(getSessionsForProject(p).map((s) => s.id)).toContain('s1')

    // A later sync that resolves to null must not un-home it.
    upsertSessions([syncedSession({ id: 's1', projectId: null })])
    expect(getSessionsForProject(p).map((s) => s.id)).toContain('s1')
  })

  it('rejects a missing session and a soft-deleted project', () => {
    const p = makeProject('P')
    upsertSessions([syncedSession({ id: 's1', projectId: null })])
    expect(() => assignSession('nope', p)).toThrow(/SESSION_NOT_FOUND/)
    deleteProject(p)
    expect(() => assignSession('s1', p)).toThrow(/PROJECT_NOT_FOUND/)
  })
})

describe('getRepoRuleSuggestionForSession', () => {
  it('suggests opt-in when the repo has no rule yet', () => {
    const p = makeProject('P')
    upsertSessions([syncedSession({ id: 's1', projectId: null, repoOwner: 'o', repoName: 'r' })])
    assignSession('s1', p)

    expect(getRepoRuleSuggestionForSession('s1', p)).toEqual({
      type: 'opt-in',
      repoOwner: 'o',
      repoName: 'r',
      projectId: p,
      projectName: 'P',
    })
  })

  it('returns null when a live repo rule already exists', () => {
    const p = makeProject('P')
    upsertSessions([syncedSession({ id: 's1', projectId: null, repoOwner: 'o', repoName: 'r' })])
    assignSession('s1', p)
    createRepoRule('o', 'r', p)

    expect(getRepoRuleSuggestionForSession('s1', p)).toBeNull()
  })

  it('still suggests (to repair) when the only rule points at a soft-deleted project', () => {
    const dead = makeProject('Dead')
    const live = makeProject('Live')
    createRepoRule('o', 'r', dead)
    deleteProject(dead)
    upsertSessions([syncedSession({ id: 's1', projectId: null, repoOwner: 'o', repoName: 'r' })])
    assignSession('s1', live)

    expect(getRepoRuleSuggestionForSession('s1', live)).toEqual({
      type: 'opt-in',
      repoOwner: 'o',
      repoName: 'r',
      projectId: live,
      projectName: 'Live',
    })
  })

  it('returns null when the session carries no repo', () => {
    const p = makeProject('P')
    upsertSessions([syncedSession({ id: 's1', projectId: null, repoOwner: null, repoName: null })])
    assignSession('s1', p)
    expect(getRepoRuleSuggestionForSession('s1', p)).toBeNull()
  })

  it('returns null for a missing session', () => {
    const p = makeProject('P')
    expect(getRepoRuleSuggestionForSession('nope', p)).toBeNull()
  })
})

describe('assign-and-remember (issue #118)', () => {
  it('assigns the session and remembers the repo so future sessions auto-assign', () => {
    const p = makeProject('P')
    upsertSessions([syncedSession({ id: 's1', projectId: null, repoOwner: 'o', repoName: 'r' })])

    // One-tap: assign the session, then remember the repo mapping.
    assignSession('s1', p)
    const suggestion = getRepoRuleSuggestionForSession('s1', p)
    expect(suggestion).not.toBeNull()
    createRepoRule(suggestion!.repoOwner, suggestion!.repoName, suggestion!.projectId)

    // The session is homed and the repo rule now exists.
    expect(getSessionsForProject(p).map((s) => s.id)).toContain('s1')
    expect(listRepoRules().map((r) => `${r.repoOwner}/${r.repoName}→${r.projectId}`)).toContain('o/r→' + p)

    // A subsequent NEW session synced from the same repo auto-resolves — no manual assign.
    const resolved = resolveProjectId('o', 'r', null)
    expect(resolved).toBe(p)
    upsertSessions([syncedSession({ id: 's2', projectId: resolved, repoOwner: 'o', repoName: 'r' })])
    expect(getSessionsForProject(p).map((s) => s.id)).toContain('s2')
    expect(getUnassignedSessions().map((s) => s.id)).not.toContain('s2')
  })

  it('the just-assigned session survives a resync that resolves to null (sticky)', () => {
    const p = makeProject('P')
    upsertSessions([syncedSession({ id: 's1', projectId: null, repoOwner: 'o', repoName: 'r' })])
    assignSession('s1', p)
    createRepoRule('o', 'r', p)

    // Force a sync whose incoming projectId is null to prove the PIN (not the rule) holds it.
    upsertSessions([syncedSession({ id: 's1', projectId: null, repoOwner: 'o', repoName: 'r' })])

    const row = db
      .prepare('SELECT project_id, pinned_project_id FROM copilot_sessions WHERE id = ?')
      .get('s1') as { project_id: number | null; pinned_project_id: number | null }
    expect(row.project_id).toBe(p)
    expect(row.pinned_project_id).toBe(p)
    expect(getUnassignedSessions().map((s) => s.id)).not.toContain('s1')
    expect(getUnassignedActiveCount()).toBe(0)
  })

  it('repairs a stale dead-project rule so new sessions resolve to the live project', () => {
    const dead = makeProject('Old')
    const live = makeProject('New')
    createRepoRule('o', 'r', dead)
    deleteProject(dead)

    // resolveProjectId skips the dead-project rule, so a synced session lands unassigned.
    expect(resolveProjectId('o', 'r', null)).toBeNull()
    upsertSessions([syncedSession({ id: 's1', projectId: resolveProjectId('o', 'r', null), repoOwner: 'o', repoName: 'r' })])
    expect(getUnassignedSessions().map((s) => s.id)).toContain('s1')

    // Assign + remember: the suggestion fires (dead rule = no live mapping) and the
    // UPSERT overwrites the stale rule to point at the live project.
    assignSession('s1', live)
    const suggestion = getRepoRuleSuggestionForSession('s1', live)
    expect(suggestion).not.toBeNull()
    createRepoRule(suggestion!.repoOwner, suggestion!.repoName, suggestion!.projectId)

    expect(listRepoRules().map((r) => `${r.repoOwner}/${r.repoName}→${r.projectId}`)).toEqual(['o/r→' + live])

    // A new synced session now resolves to the live project.
    expect(resolveProjectId('o', 'r', null)).toBe(live)
    upsertSessions([syncedSession({ id: 's2', projectId: resolveProjectId('o', 'r', null), repoOwner: 'o', repoName: 'r' })])
    expect(getSessionsForProject(live).map((s) => s.id)).toContain('s2')
  })
})

describe('deleteProject clears the pin', () => {
  it('a launched session drops to unassigned when its project is deleted', () => {
    const p = makeProject('P')
    insertLaunchedSession({
      id: 's1', title: 'Fix it', repoOwner: 'o', repoName: 'r',
      htmlUrl: null, linkedPrUrl: null, projectId: p,
    })
    deleteProject(p)

    const unassigned = getUnassignedSessions()
    expect(unassigned.map((s) => s.id)).toContain('s1')
    expect(unassigned[0].pinnedProjectId).toBeNull()
  })
})

describe('launched session folds into the re-entry digest', () => {
  it('a just-launched session appears as a working item on its project digest', () => {
    const p = makeProject('P')
    insertLaunchedSession({
      id: 's1', title: 'Fix the flaky test', repoOwner: 'o', repoName: 'r',
      htmlUrl: 'https://x/pull/1', linkedPrUrl: 'https://x/pull/1', projectId: p,
    })

    const digest = getDigest(p)
    const kinds = digest.items.map((i) => i.kind)
    expect(kinds).toContain('agent-in-progress')
    const item = digest.items.find((i) => i.kind === 'agent-in-progress')
    expect(item?.text).toMatch(/Fix the flaky test/)
  })
})

describe('launch liveness + pin hygiene', () => {
  it('a launch targeting a soft-deleted project is tracked as unassigned, not lost', () => {
    const p = makeProject('P')
    deleteProject(p)
    const s = insertLaunchedSession({
      id: 's1', title: 't', repoOwner: 'o', repoName: 'r', htmlUrl: null, linkedPrUrl: null, projectId: p,
    })
    expect(s.projectId).toBeNull()
    expect(s.pinnedProjectId).toBeNull()
    expect(getUnassignedSessions().map((x) => x.id)).toContain('s1')
  })

  it('a launch with a non-existent project id does not throw and tracks unassigned', () => {
    const s = insertLaunchedSession({
      id: 's2', title: 't', repoOwner: 'o', repoName: 'r', htmlUrl: null, linkedPrUrl: null, projectId: 9999,
    })
    expect(s.projectId).toBeNull()
    expect(getUnassignedSessions().map((x) => x.id)).toContain('s2')
  })

  it('a sync clears a pin whose project is gone (no snap-back on restore)', () => {
    const p = makeProject('P')
    insertLaunchedSession({
      id: 's3', title: 't', repoOwner: 'o', repoName: 'r', htmlUrl: null, linkedPrUrl: null, projectId: p,
    })
    // Soft-delete directly (bypassing deleteProject's own pin-clearing) to prove
    // the sync writer independently drops a dead pin.
    db.prepare('UPDATE projects SET deleted_at = ? WHERE id = ?').run('2026-07-02T00:00:00Z', p)
    upsertSessions([syncedSession({ id: 's3', projectId: null })])
    const row = db
      .prepare('SELECT project_id, pinned_project_id FROM copilot_sessions WHERE id = ?')
      .get('s3') as { project_id: number | null; pinned_project_id: number | null }
    expect(row.pinned_project_id).toBeNull()
    expect(row.project_id).toBeNull()
  })
})

describe('getLaunchTargets', () => {
  it('unions repo rules and notification threads, distinct, rules first', () => {
    const p = makeProject('P')
    db.prepare('INSERT INTO repo_rules (repo_owner, repo_name, project_id) VALUES (?, ?, ?)').run('o', 'ruled', p)
    db.prepare(
      `INSERT INTO notification_threads (id, project_id, repo_owner, repo_name, title, type, reason, updated_at, api_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('n1', p, 'o', 'threaded', 'T', 'PullRequest', 'review_requested', '2026-07-02T00:00:00Z', 'https://api')
    // A duplicate of the ruled repo via a thread should not double up.
    db.prepare(
      `INSERT INTO notification_threads (id, project_id, repo_owner, repo_name, title, type, reason, updated_at, api_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('n2', p, 'o', 'ruled', 'T2', 'Issue', 'mention', '2026-07-03T00:00:00Z', 'https://api')

    const targets = getLaunchTargets(p)
    const keys = targets.map((t) => `${t.repoOwner}/${t.repoName}`)
    expect(keys).toEqual(['o/ruled', 'o/threaded']) // rule repo first, distinct
  })
})
