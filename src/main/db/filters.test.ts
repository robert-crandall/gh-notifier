import { describe, it, expect, vi } from 'vitest'

// Prevent the electron import in ./index from executing during tests.
vi.mock('./index', () => ({ getDb: vi.fn() }))

import { filterMatches, shouldSuppress } from './filters'
import type { NotificationFilter, NotificationThread } from '../../shared/ipc-channels'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeThread(overrides: Partial<NotificationThread> = {}): NotificationThread {
  return {
    id: 'thread-1',
    projectId: null,
    repoOwner: 'acme-corp',
    repoName: 'my-repo',
    title: 'Fix the bug [bot] patch',
    type: 'PullRequest',
    reason: 'mention',
    unread: true,
    updatedAt: '2024-01-01T00:00:00Z',
    lastReadAt: null,
    apiUrl: 'https://api.github.com/notifications/threads/1',
    subjectUrl: null,
    subjectState: null,
    htmlUrl: null,
    ...overrides,
  }
}

function makeFilter(overrides: Partial<NotificationFilter>): NotificationFilter {
  return {
    id: 1,
    dimension: 'type',
    value: 'PullRequest',
    scope: 'global',
    scopeOwner: null,
    scopeRepo: null,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// ── filterMatches ─────────────────────────────────────────────────────────────

describe('filterMatches', () => {
  describe('author dimension', () => {
    it('matches when filter value is a substring of the title (case-insensitive)', () => {
      const filter = makeFilter({ dimension: 'author', value: 'BOT' })
      expect(filterMatches(filter, makeThread({ title: 'Fix the bug [bot] patch' }))).toBe(true)
    })

    it('does not match when substring is absent', () => {
      const filter = makeFilter({ dimension: 'author', value: 'alice' })
      expect(filterMatches(filter, makeThread({ title: 'Fix the bug' }))).toBe(false)
    })
  })

  describe('org dimension', () => {
    it('matches when filter value is a substring of repoOwner (case-insensitive)', () => {
      const filter = makeFilter({ dimension: 'org', value: 'ACME' })
      expect(filterMatches(filter, makeThread({ repoOwner: 'acme-corp' }))).toBe(true)
    })

    it('does not match on a different org', () => {
      const filter = makeFilter({ dimension: 'org', value: 'other' })
      expect(filterMatches(filter, makeThread({ repoOwner: 'acme-corp' }))).toBe(false)
    })
  })

  describe('repo dimension', () => {
    it('matches when filter value is a substring of repoName (case-insensitive)', () => {
      const filter = makeFilter({ dimension: 'repo', value: 'MY-REPO' })
      expect(filterMatches(filter, makeThread({ repoName: 'my-repo' }))).toBe(true)
    })

    it('does not match on a different repo', () => {
      const filter = makeFilter({ dimension: 'repo', value: 'other-repo' })
      expect(filterMatches(filter, makeThread({ repoName: 'my-repo' }))).toBe(false)
    })
  })

  describe('reason dimension', () => {
    it('matches on exact reason (case-insensitive)', () => {
      const filter = makeFilter({ dimension: 'reason', value: 'MENTION' })
      expect(filterMatches(filter, makeThread({ reason: 'mention' }))).toBe(true)
    })

    it('does not match on a different reason', () => {
      const filter = makeFilter({ dimension: 'reason', value: 'assign' })
      expect(filterMatches(filter, makeThread({ reason: 'mention' }))).toBe(false)
    })
  })

  describe('state dimension', () => {
    it('matches when subjectState equals filter value (case-insensitive)', () => {
      const filter = makeFilter({ dimension: 'state', value: 'OPEN' })
      expect(filterMatches(filter, makeThread({ subjectState: 'open' }))).toBe(true)
    })

    it('does not match when state differs', () => {
      const filter = makeFilter({ dimension: 'state', value: 'closed' })
      expect(filterMatches(filter, makeThread({ subjectState: 'open' }))).toBe(false)
    })

    it('does not match when subjectState is null (not yet prefetched)', () => {
      const filter = makeFilter({ dimension: 'state', value: 'open' })
      expect(filterMatches(filter, makeThread({ subjectState: null }))).toBe(false)
    })
  })

  describe('type dimension', () => {
    it('matches on exact type (case-insensitive)', () => {
      const filter = makeFilter({ dimension: 'type', value: 'pullrequest' })
      expect(filterMatches(filter, makeThread({ type: 'PullRequest' }))).toBe(true)
    })

    it('does not match on a different type', () => {
      const filter = makeFilter({ dimension: 'type', value: 'Issue' })
      expect(filterMatches(filter, makeThread({ type: 'PullRequest' }))).toBe(false)
    })
  })
})

// ── shouldSuppress ────────────────────────────────────────────────────────────

describe('shouldSuppress', () => {
  it('returns false for an empty filter list', () => {
    expect(shouldSuppress(makeThread(), [])).toBe(false)
  })

  it('returns true when a single global filter matches', () => {
    const filter = makeFilter({ dimension: 'type', value: 'PullRequest', scope: 'global' })
    expect(shouldSuppress(makeThread({ type: 'PullRequest' }), [filter])).toBe(true)
  })

  it('returns false when a single global filter does not match', () => {
    const filter = makeFilter({ dimension: 'type', value: 'Issue', scope: 'global' })
    expect(shouldSuppress(makeThread({ type: 'PullRequest' }), [filter])).toBe(false)
  })

  it('returns true when any one of multiple filters matches (OR logic)', () => {
    const filters = [
      makeFilter({ id: 1, dimension: 'type', value: 'Issue', scope: 'global' }),
      makeFilter({ id: 2, dimension: 'type', value: 'PullRequest', scope: 'global' }),
    ]
    expect(shouldSuppress(makeThread({ type: 'PullRequest' }), filters)).toBe(true)
  })

  it('returns true when a repo-scoped type filter matches the correct repo and type', () => {
    const filter = makeFilter({
      dimension: 'type',
      value: 'PullRequest',
      scope: 'repo',
      scopeOwner: 'acme-corp',
      scopeRepo: 'my-repo',
    })
    expect(
      shouldSuppress(
        makeThread({ repoOwner: 'acme-corp', repoName: 'my-repo', type: 'PullRequest' }),
        [filter],
      ),
    ).toBe(true)
  })

  it('returns false when a repo-scoped filter matches type but the thread is from a different repo', () => {
    const filter = makeFilter({
      dimension: 'type',
      value: 'PullRequest',
      scope: 'repo',
      scopeOwner: 'other-org',
      scopeRepo: 'other-repo',
    })
    expect(shouldSuppress(makeThread({ type: 'PullRequest' }), [filter])).toBe(false)
  })
})
