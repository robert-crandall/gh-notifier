import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))

vi.mock('../db/index', () => ({ getDb: vi.fn() }))

import { getDb } from '../db/index'
import { runMigrations } from '../db/migrate'
import { createProject, getProject, listInboxTodos } from '../db/projects'
import { createRepoRule } from '../db/notifications'
import { runAddTodo } from './add-todo'

let db: BunDb

beforeEach(() => {
  db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)
})

function textOf(result: CallToolResult): string {
  const first = result.content[0]
  return first.type === 'text' ? first.text : ''
}

describe('runAddTodo — validation', () => {
  it('requires a non-empty title', () => {
    expect(runAddTodo({}).isError).toBe(true)
    expect(runAddTodo({ title: '   ' }).isError).toBe(true)
  })

  it('rejects a non-http(s) sourceUrl', () => {
    const r = runAddTodo({ title: 'x', sourceUrl: 'javascript:alert(1)' })
    expect(r.isError).toBe(true)
    expect(textOf(r)).toMatch(/sourceUrl/)
  })

  it('rejects a suggestedAction with a bad url scheme', () => {
    const r = runAddTodo({ title: 'x', suggestedAction: { kind: 'open_url', url: 'file:///etc/passwd' } })
    expect(r.isError).toBe(true)
  })

  it('rejects an unknown suggestedAction kind', () => {
    const r = runAddTodo({ title: 'x', suggestedAction: { kind: 'launch_missiles' } })
    expect(r.isError).toBe(true)
  })

  it('rejects a pr_comment without a comment', () => {
    const r = runAddTodo({ title: 'x', suggestedAction: { kind: 'pr_comment', url: 'https://e.com/1' } })
    expect(r.isError).toBe(true)
  })
})

describe('runAddTodo — resolution', () => {
  it('lands in the Inbox with no project/repo', () => {
    const r = runAddTodo({ title: 'Unrouted' })
    expect(r.isError).toBeUndefined()
    expect(textOf(r)).toMatch(/Inbox/)
    expect(listInboxTodos().map((t) => t.title)).toContain('Unrouted')
  })

  it('files under an explicit project by name', () => {
    const p = createProject('Alpha')
    const r = runAddTodo({ project: 'alpha', title: 'Task' }) // case-insensitive
    expect(r.isError).toBeUndefined()
    expect(getProject(p.id).todos.map((t) => t.title)).toContain('Task')
  })

  it('errors when the explicit project does not exist', () => {
    const r = runAddTodo({ project: 'Ghost', title: 'Task' })
    expect(r.isError).toBe(true)
    expect(textOf(r)).toMatch(/Ghost/)
  })

  it('routes a repo through the routing rules', () => {
    const p = createProject('Routed')
    createRepoRule('acme', 'widgets', p.id)
    const r = runAddTodo({ repo: 'acme/widgets', title: 'From repo' })
    expect(r.isError).toBeUndefined()
    expect(getProject(p.id).todos.map((t) => t.title)).toContain('From repo')
  })

  it('drops an unresolved repo into the Inbox', () => {
    const r = runAddTodo({ repo: 'nobody/nothing', title: 'Stray' })
    expect(textOf(r)).toMatch(/Inbox/)
    expect(listInboxTodos().map((t) => t.title)).toContain('Stray')
  })

  it('a malformed repo string lands in the Inbox rather than erroring', () => {
    const r = runAddTodo({ repo: 'not-a-repo', title: 'Weird' })
    expect(r.isError).toBeUndefined()
    expect(listInboxTodos().map((t) => t.title)).toContain('Weird')
  })

  it('tolerates a github.com-prefixed repo (with or without scheme)', () => {
    const p = createProject('Prefixed')
    createRepoRule('acme', 'widgets', p.id)
    runAddTodo({ repo: 'github.com/acme/widgets', title: 'bare host' })
    runAddTodo({ repo: 'https://github.com/acme/widgets', title: 'full url' })
    expect(getProject(p.id).todos.map((t) => t.title)).toEqual(
      expect.arrayContaining(['bare host', 'full url'])
    )
  })
})

describe('runAddTodo — idempotency', () => {
  it('re-review of the same PR with the same action updates in place (no duplicate)', () => {
    const p = createProject('Repo')
    createRepoRule('acme', 'widgets', p.id)
    const args = {
      repo: 'acme/widgets',
      title: 'Approve PR',
      sourceUrl: 'https://github.com/acme/widgets/pull/7',
      suggestedAction: { kind: 'pr_comment', url: 'https://github.com/acme/widgets/pull/7', comment: 'nice' },
    }
    const first = runAddTodo(args)
    expect(textOf(first)).toMatch(/Created/)
    const second = runAddTodo({ ...args, title: 'Approve PR (updated)' })
    expect(textOf(second)).toMatch(/Updated/)
    const todos = getProject(p.id).todos
    expect(todos).toHaveLength(1)
    expect(todos[0].title).toBe('Approve PR (updated)')
  })

  it('distinct actions on the same PR produce distinct todos', () => {
    const p = createProject('Repo')
    createRepoRule('acme', 'widgets', p.id)
    const url = 'https://github.com/acme/widgets/pull/7'
    runAddTodo({ repo: 'acme/widgets', title: 'Comment A', sourceUrl: url, suggestedAction: { kind: 'pr_comment', url, comment: 'A' } })
    runAddTodo({ repo: 'acme/widgets', title: 'Comment B', sourceUrl: url, suggestedAction: { kind: 'pr_comment', url, comment: 'B' } })
    expect(getProject(p.id).todos).toHaveLength(2)
  })

  it('a sourceUrl differing only by trailing case in the host still dedups', () => {
    const p = createProject('Repo')
    createRepoRule('acme', 'widgets', p.id)
    runAddTodo({ repo: 'acme/widgets', title: 'a', sourceUrl: 'https://GitHub.com/acme/widgets/pull/7' })
    runAddTodo({ repo: 'acme/widgets', title: 'b', sourceUrl: 'https://github.com/acme/widgets/pull/7' })
    expect(getProject(p.id).todos).toHaveLength(1)
  })

  it('no sourceUrl means no dedup — each call inserts', () => {
    const p = createProject('Repo')
    createRepoRule('acme', 'widgets', p.id)
    runAddTodo({ repo: 'acme/widgets', title: 'a' })
    runAddTodo({ repo: 'acme/widgets', title: 'a' })
    expect(getProject(p.id).todos).toHaveLength(2)
  })
})
