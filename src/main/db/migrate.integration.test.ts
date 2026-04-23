import { describe, it, expect, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'

// Provide a fake electron app so getMigrationsDir() resolves to the real
// db/migrations folder without needing a running Electron instance.
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
  },
}))

import { runMigrations } from './migrate'

function freshDb(): BetterSQLite3.Database {
  return new Database(':memory:') as unknown as BetterSQLite3.Database
}

describe('runMigrations', () => {
  it('applies all migrations without error', () => {
    const db = freshDb()
    expect(() => runMigrations(db)).not.toThrow()
  })

  it('creates expected tables after migration', () => {
    const db = freshDb()
    runMigrations(db)

    const tables = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
        .all() as { name: string }[]
    ).map((r) => r.name)

    expect(tables).toContain('projects')
    expect(tables).toContain('project_todos')
    expect(tables).toContain('project_links')
    expect(tables).toContain('notification_threads')
    expect(tables).toContain('repo_rules')
    expect(tables).toContain('sync_metadata')
    expect(tables).toContain('filters')
    expect(tables).toContain('_migrations')
  })

  it('records each applied migration in the _migrations table', () => {
    const db = freshDb()
    runMigrations(db)

    const applied = (
      db.prepare('SELECT filename FROM _migrations ORDER BY filename').all() as { filename: string }[]
    ).map((r) => r.filename)

    // All .sql files in db/migrations should be recorded
    expect(applied.length).toBeGreaterThan(0)
    applied.forEach((f) => expect(f).toMatch(/\.sql$/))
    // Spot-check a known migration
    expect(applied).toContain('006_filters.sql')
  })

  it('is idempotent — running migrations twice does not throw or duplicate entries', () => {
    const db = freshDb()
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()

    const count = (
      db.prepare('SELECT COUNT(*) as n FROM _migrations').get() as { n: number }
    ).n
    // Running twice should not create duplicate rows
    runMigrations(db)
    const countAfter = (
      db.prepare('SELECT COUNT(*) as n FROM _migrations').get() as { n: number }
    ).n
    expect(countAfter).toBe(count)
  })

  it('applies migrations in filename order', () => {
    const db = freshDb()
    runMigrations(db)

    const applied = (
      db.prepare('SELECT filename FROM _migrations ORDER BY id ASC').all() as { filename: string }[]
    ).map((r) => r.filename)

    const sorted = [...applied].sort()
    expect(applied).toEqual(sorted)
  })
})
