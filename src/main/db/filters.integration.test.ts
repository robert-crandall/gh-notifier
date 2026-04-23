import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))

vi.mock('./index', () => ({ getDb: vi.fn() }))

import { getDb } from './index'
import { runMigrations } from './migrate'
import { createFilter, deleteFilter, listFilters } from './filters'

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  const db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)
})

// ── createFilter / listFilters ────────────────────────────────────────────────

describe('createFilter', () => {
  it('stores a global author filter and returns it from listFilters', () => {
    createFilter('author', 'bot')
    const filters = listFilters()
    expect(filters).toHaveLength(1)
    expect(filters[0].dimension).toBe('author')
    expect(filters[0].value).toBe('bot')
    expect(filters[0].scope).toBe('global')
    expect(filters[0].scopeOwner).toBeNull()
    expect(filters[0].scopeRepo).toBeNull()
  })

  it('stores a repo-scoped type filter with correct scope fields', () => {
    createFilter('type', 'PullRequest', 'repo', 'acme-corp', 'my-repo')
    const filters = listFilters()
    expect(filters).toHaveLength(1)
    expect(filters[0].scope).toBe('repo')
    expect(filters[0].scopeOwner).toBe('acme-corp')
    expect(filters[0].scopeRepo).toBe('my-repo')
  })

  it('accepts a global scope for the type dimension', () => {
    expect(() => createFilter('type', 'Issue', 'global')).not.toThrow()
    expect(listFilters()).toHaveLength(1)
  })

  it('rejects a repo-scoped filter for a dimension other than "type"', () => {
    // The DB CHECK constraint prevents this combination
    expect(() =>
      createFilter('author', 'bot', 'repo', 'acme-corp', 'my-repo')
    ).toThrow()
  })

  it('rejects a repo-scoped type filter with missing scope_owner', () => {
    expect(() => createFilter('type', 'PullRequest', 'repo', undefined, 'my-repo')).toThrow()
  })

  it('trims whitespace from the value', () => {
    createFilter('author', '  dependabot  ')
    expect(listFilters()[0].value).toBe('dependabot')
  })
})

// ── deleteFilter ──────────────────────────────────────────────────────────────

describe('deleteFilter', () => {
  it('removes the filter; it no longer appears in listFilters', () => {
    const f = createFilter('author', 'bot')
    expect(listFilters()).toHaveLength(1)
    deleteFilter(f.id)
    expect(listFilters()).toHaveLength(0)
  })

  it('is a no-op when the id does not exist', () => {
    createFilter('author', 'bot')
    expect(() => deleteFilter(999)).not.toThrow()
    expect(listFilters()).toHaveLength(1)
  })
})
