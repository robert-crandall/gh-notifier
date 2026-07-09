import { describe, it, expect, vi } from 'vitest'

// Prevent the electron import in ./index from executing during tests.
vi.mock('./index', () => ({ getDb: vi.fn() }))

import { toProject, toTodo, toLink } from './projects'

// ── toProject ─────────────────────────────────────────────────────────────────

describe('toProject', () => {
  it('maps all fields from snake_case to camelCase', () => {
    const row = {
      id: 1,
      name: 'My Project',
      notes: 'Some notes',
      next_action: 'Do the thing',
      status: 'active',
      sort_order: 0,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      snooze_until: null as string | null,
      snooze_mode: null as string | null,
      last_focused_at: '2024-01-03T00:00:00Z' as string | null,
      digest_seen_at: null as string | null,
      drift_snoozed_until: null as string | null,
      deleted_at: null as string | null,
    }
    expect(toProject(row)).toEqual({
      id: 1,
      name: 'My Project',
      notes: 'Some notes',
      nextAction: 'Do the thing',
      status: 'active',
      sortOrder: 0,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      unreadCount: 0,
      activeTodoCount: 0,
      snoozeMode: null,
      snoozeUntil: null,
      copilotStatus: null,
      lastFocusedAt: '2024-01-03T00:00:00Z',
      driftState: 'active',
    })
  })

  it('always initialises unreadCount to 0 (JOIN sets the real value in listProjects)', () => {
    const row = {
      id: 1, name: 'P', notes: '', next_action: '', status: 'active',
      sort_order: 0, created_at: '', updated_at: '',
      snooze_until: null as string | null, snooze_mode: null as string | null,
      last_focused_at: null as string | null, digest_seen_at: null as string | null,
      drift_snoozed_until: null as string | null, deleted_at: null as string | null,
    }
    expect(toProject(row).unreadCount).toBe(0)
    expect(toProject(row).activeTodoCount).toBe(0)
  })

  it('maps snooze fields when present and classifies a snoozed project as parked', () => {
    const row = {
      id: 2,
      name: 'Snoozed',
      notes: '',
      next_action: '',
      status: 'snoozed',
      sort_order: 1,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      snooze_until: '2024-12-31T00:00:00Z' as string | null,
      snooze_mode: 'date' as string | null,
      last_focused_at: null as string | null, digest_seen_at: null as string | null,
      drift_snoozed_until: null as string | null, deleted_at: null as string | null,
    }
    const project = toProject(row)
    expect(project.snoozeMode).toBe('date')
    expect(project.snoozeUntil).toBe('2024-12-31T00:00:00Z')
    expect(project.driftState).toBe('parked')
  })

  it('maps null snooze_mode to null (not undefined or empty string)', () => {
    const row = {
      id: 1, name: 'P', notes: '', next_action: '', status: 'active',
      sort_order: 0, created_at: '', updated_at: '',
      snooze_until: null as string | null, snooze_mode: null as string | null,
      last_focused_at: null as string | null, digest_seen_at: null as string | null,
      drift_snoozed_until: null as string | null, deleted_at: null as string | null,
    }
    expect(toProject(row).snoozeMode).toBeNull()
    expect(toProject(row).snoozeUntil).toBeNull()
  })
})

// ── toTodo ────────────────────────────────────────────────────────────────────

describe('toTodo', () => {
  const baseRow = {
    deleted_at: null as string | null,
    title: null as string | null,
    body: null as string | null,
    source_url: null as string | null,
    suggested_action: null as string | null,
    origin: 'user',
    idempotency_key: null as string | null,
  }

  it('maps all fields', () => {
    const row = {
      id: 5, project_id: 1 as number | null, text: 'Do something', done: 0 as number,
      sort_order: 2, created_at: '2024-01-01T00:00:00Z', ...baseRow,
    }
    expect(toTodo(row)).toEqual({
      id: 5,
      projectId: 1,
      text: 'Do something',
      done: false,
      sortOrder: 2,
      createdAt: '2024-01-01T00:00:00Z',
      title: null,
      body: null,
      sourceUrl: null,
      suggestedAction: null,
      origin: 'user',
      idempotencyKey: null,
    })
  })

  it('maps agent-todo fields and parses suggested_action JSON', () => {
    const row = {
      id: 9, project_id: null as number | null, text: 'Approve PR', done: 0 as number,
      sort_order: 0, created_at: '', ...baseRow,
      title: 'Approve PR', body: 'Looks good', source_url: 'https://example.com/pr/1',
      suggested_action: JSON.stringify({ kind: 'open_url', url: 'https://example.com/pr/1' }),
      origin: 'copilot', idempotency_key: 'abc',
    }
    const todo = toTodo(row)
    expect(todo.projectId).toBeNull()
    expect(todo.origin).toBe('copilot')
    expect(todo.title).toBe('Approve PR')
    expect(todo.suggestedAction).toEqual({ kind: 'open_url', url: 'https://example.com/pr/1' })
    expect(todo.idempotencyKey).toBe('abc')
  })

  it('degrades a corrupt suggested_action blob to null', () => {
    const row = {
      id: 1, project_id: 1 as number | null, text: 'T', done: 0 as number, sort_order: 0,
      created_at: '', ...baseRow, suggested_action: '{not json',
    }
    expect(toTodo(row).suggestedAction).toBeNull()
  })

  it('converts done integer 1 to boolean true', () => {
    const row = { id: 1, project_id: 1 as number | null, text: 'T', done: 1 as number, sort_order: 0, created_at: '', ...baseRow }
    expect(toTodo(row).done).toBe(true)
  })

  it('converts done integer 0 to boolean false', () => {
    const row = { id: 1, project_id: 1 as number | null, text: 'T', done: 0 as number, sort_order: 0, created_at: '', ...baseRow }
    expect(toTodo(row).done).toBe(false)
  })
})

// ── toLink ────────────────────────────────────────────────────────────────────

describe('toLink', () => {
  it('maps all fields', () => {
    const row = { id: 3, project_id: 1, label: 'Docs', url: 'https://example.com', sort_order: 0 }
    expect(toLink(row)).toEqual({
      id: 3,
      projectId: 1,
      label: 'Docs',
      url: 'https://example.com',
      sortOrder: 0,
    })
  })
})
