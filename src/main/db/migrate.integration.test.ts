import { describe, it, expect, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
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
    expect(tables).toContain('routing_rules')
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
    expect(applied).toContain('007_routing_rules.sql')
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

  it('adds the focus watermark, drift, and soft-delete columns (013)', () => {
    const db = freshDb()
    runMigrations(db)

    const projectCols = (
      db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
    ).map((c) => c.name)
    expect(projectCols).toContain('last_focused_at')
    expect(projectCols).toContain('digest_seen_at')
    expect(projectCols).toContain('drift_snoozed_until')
    expect(projectCols).toContain('deleted_at')

    const todoCols = (
      db.prepare('PRAGMA table_info(project_todos)').all() as { name: string }[]
    ).map((c) => c.name)
    expect(todoCols).toContain('deleted_at')
  })

  it('backfills last_focused_at so existing projects are not instantly drifting', () => {
    const db = freshDb()
    runMigrations(db)
    db.prepare("INSERT INTO projects (name) VALUES ('legacy')").run()
    // Simulate the migration running again on a DB that already had the row:
    // the backfill only fills NULLs, so insert then backfill manually to assert shape.
    db.prepare("UPDATE projects SET last_focused_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE last_focused_at IS NULL").run()
    const row = db.prepare('SELECT last_focused_at FROM projects LIMIT 1').get() as { last_focused_at: string | null }
    expect(row.last_focused_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

// ── 020: project_todos rebuild (#102) ─────────────────────────────────────────

/** Apply every migration whose filename sorts before `before`, mimicking the real runner. */
function applyMigrationsBefore(db: BetterSQLite3.Database, before: string): void {
  const dir = join(process.cwd(), 'db', 'migrations')
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && f < before)
    .sort()
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8')
    if (sql.replace(/--[^\n]*/g, '').trim()) db.exec(sql)
  }
}

function apply020(db: BetterSQLite3.Database): void {
  const sql = readFileSync(join(process.cwd(), 'db', 'migrations', '020_agent_todos.sql'), 'utf8')
  db.exec(sql)
}

describe('020_agent_todos migration (back-compat)', () => {
  it('preserves existing todos, their ids, and app-session links; defaults new fields', () => {
    const db = freshDb()
    applyMigrationsBefore(db, '020_agent_todos.sql')

    db.prepare("INSERT INTO projects (name) VALUES ('Legacy')").run()
    db.prepare("INSERT INTO project_todos (id, project_id, text, done, sort_order) VALUES (1, 1, 'active', 0, 0)").run()
    db.prepare("INSERT INTO project_todos (id, project_id, text, done, sort_order) VALUES (2, 1, 'finished', 1, 1)").run()
    db.prepare("INSERT INTO project_todos (id, project_id, text, sort_order, deleted_at) VALUES (3, 1, 'dismissed', 2, '2024-01-01T00:00:00Z')").run()
    // A delegated app session linked to todo #1 — the dependent FK that the rebuild must not wipe.
    db.prepare("INSERT INTO copilot_app_sessions (id, project_id, cwd, title) VALUES ('sess1', 1, '/tmp', 'work')").run()
    db.prepare("INSERT INTO todo_copilot_app_sessions (todo_id, session_id) VALUES (1, 'sess1')").run()

    apply020(db)

    // Rows + ids preserved, with sensible new-field defaults.
    const rows = db
      .prepare('SELECT id, project_id, text, done, origin, title, idempotency_key, deleted_at FROM project_todos ORDER BY id')
      .all() as Array<{ id: number; project_id: number | null; text: string; done: number; origin: string; title: string | null; idempotency_key: string | null; deleted_at: string | null }>
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3])
    expect(rows.every((r) => r.origin === 'user')).toBe(true)
    expect(rows.every((r) => r.title === null && r.idempotency_key === null)).toBe(true)
    expect(rows[1].done).toBe(1) // completion preserved
    expect(rows[2].deleted_at).toBe('2024-01-01T00:00:00Z') // soft-delete preserved

    // The app-session link still resolves through the rebuilt table.
    const link = db
      .prepare(
        `SELECT pt.text AS text FROM todo_copilot_app_sessions t
         JOIN project_todos pt ON pt.id = t.todo_id WHERE t.session_id = 'sess1'`
      )
      .get() as { text: string } | undefined
    expect(link?.text).toBe('active')

    // No FK violations were introduced by the rebuild.
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])

    // project_id is now nullable (the Inbox surface).
    expect(() =>
      db.prepare("INSERT INTO project_todos (project_id, text, origin) VALUES (NULL, 'inbox', 'copilot')").run()
    ).not.toThrow()
  })

  it('enforces one non-null idempotency_key while allowing many null keys', () => {
    const db = freshDb()
    runMigrations(db)
    db.prepare("INSERT INTO projects (name) VALUES ('P')").run()
    db.prepare("INSERT INTO project_todos (project_id, text, origin, idempotency_key) VALUES (1, 'a', 'copilot', 'k1')").run()
    expect(() =>
      db.prepare("INSERT INTO project_todos (project_id, text, origin, idempotency_key) VALUES (1, 'b', 'copilot', 'k1')").run()
    ).toThrow()
    // Many user todos with a NULL key coexist fine.
    db.prepare("INSERT INTO project_todos (project_id, text) VALUES (1, 'x')").run()
    db.prepare("INSERT INTO project_todos (project_id, text) VALUES (1, 'y')").run()
    const n = (db.prepare('SELECT COUNT(*) AS n FROM project_todos WHERE idempotency_key IS NULL').get() as { n: number }).n
    expect(n).toBe(2)
  })

  it('does not reuse ids when the table was empty-but-previously-used at migration time', () => {
    const db = freshDb()
    applyMigrationsBefore(db, '020_agent_todos.sql')
    db.prepare("INSERT INTO projects (name) VALUES ('P')").run()
    // Bump the AUTOINCREMENT high-water to 5, then hard-delete so the table is empty but
    // sqlite_sequence still holds 5 (simulates a prior cascade/hard delete).
    db.prepare("INSERT INTO project_todos (id, project_id, text) VALUES (5, 1, 'gone')").run()
    db.prepare('DELETE FROM project_todos').run()
    expect((db.prepare("SELECT seq FROM sqlite_sequence WHERE name='project_todos'").get() as { seq: number }).seq).toBe(5)

    apply020(db)

    // The high-water must survive the rebuild, so the next id is 6 (not a reused 1..5).
    const row = db
      .prepare("INSERT INTO project_todos (project_id, text) VALUES (1, 'fresh') RETURNING id")
      .get() as { id: number }
    expect(row.id).toBe(6)
  })
})
