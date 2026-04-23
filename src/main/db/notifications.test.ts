import { describe, it, expect, vi } from 'vitest'

// Prevent the electron import in ./index from executing during tests.
vi.mock('./index', () => ({ getDb: vi.fn() }))

import { toThread } from './notifications'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(overrides: {
  id?: string
  project_id?: number | null
  repo_owner?: string
  repo_name?: string
  title?: string
  type?: string
  reason?: string
  unread?: number
  updated_at?: string
  last_read_at?: string | null
  api_url?: string
  synced_at?: string
  subject_url?: string | null
  subject_state?: string | null
  html_url?: string | null
  content_fetched_at?: string | null
} = {}) {
  return {
    id: 'thread-1',
    project_id: null as number | null,
    repo_owner: 'acme-corp',
    repo_name: 'my-repo',
    title: 'Fix the bug',
    type: 'PullRequest',
    reason: 'mention',
    unread: 1,
    updated_at: '2024-01-01T00:00:00Z',
    last_read_at: null as string | null,
    api_url: 'https://api.github.com/notifications/threads/1',
    synced_at: '2024-01-01T00:00:00Z',
    subject_url: null as string | null,
    subject_state: null as string | null,
    html_url: null as string | null,
    content_fetched_at: null as string | null,
    ...overrides,
  }
}

// ── toThread ──────────────────────────────────────────────────────────────────

describe('toThread', () => {
  it('maps all fields from snake_case to camelCase', () => {
    const row = makeRow({
      id: 'abc123',
      project_id: 1,
      repo_owner: 'acme-corp',
      repo_name: 'my-repo',
      title: 'Fix the bug',
      type: 'PullRequest',
      reason: 'mention',
      unread: 1,
      updated_at: '2024-01-01T00:00:00Z',
      last_read_at: null,
      api_url: 'https://api.github.com/notifications/threads/1',
      subject_url: 'https://api.github.com/repos/acme-corp/my-repo/pulls/42',
      subject_state: 'open',
      html_url: 'https://github.com/acme-corp/my-repo/pull/42',
    })
    expect(toThread(row)).toEqual({
      id: 'abc123',
      projectId: 1,
      repoOwner: 'acme-corp',
      repoName: 'my-repo',
      title: 'Fix the bug',
      type: 'PullRequest',
      reason: 'mention',
      unread: true,
      updatedAt: '2024-01-01T00:00:00Z',
      lastReadAt: null,
      apiUrl: 'https://api.github.com/notifications/threads/1',
      subjectUrl: 'https://api.github.com/repos/acme-corp/my-repo/pulls/42',
      subjectState: 'open',
      htmlUrl: 'https://github.com/acme-corp/my-repo/pull/42',
    })
  })

  it('converts unread integer 1 to boolean true', () => {
    expect(toThread(makeRow({ unread: 1 })).unread).toBe(true)
  })

  it('converts unread integer 0 to boolean false', () => {
    expect(toThread(makeRow({ unread: 0 })).unread).toBe(false)
  })

  it('maps nullable fields as null when absent', () => {
    const thread = toThread(makeRow({
      project_id: null,
      last_read_at: null,
      subject_url: null,
      subject_state: null,
      html_url: null,
    }))
    expect(thread.projectId).toBeNull()
    expect(thread.lastReadAt).toBeNull()
    expect(thread.subjectUrl).toBeNull()
    expect(thread.subjectState).toBeNull()
    expect(thread.htmlUrl).toBeNull()
  })

  it('does not leak DB-only columns (synced_at, content_fetched_at) into the domain model', () => {
    const thread = toThread(makeRow({}))
    expect(thread).not.toHaveProperty('syncedAt')
    expect(thread).not.toHaveProperty('contentFetchedAt')
  })
})
