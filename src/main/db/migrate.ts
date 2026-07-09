import Database from 'better-sqlite3'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

function getMigrationsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'db', 'migrations')
  }
  return join(app.getAppPath(), 'db', 'migrations')
}

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      filename    TEXT    NOT NULL UNIQUE,
      applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const migrationsDir = getMigrationsDir()
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const applied = new Set(
    (db.prepare('SELECT filename FROM _migrations').all() as { filename: string }[]).map(
      (r) => r.filename
    )
  )

  for (const file of files) {
    if (!applied.has(file)) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8')
      // Strip SQL comments and skip files that contain no actual statements
      const strippedSql = sql.replace(/--[^\n]*/g, '').trim()
      if (strippedSql) {
        try {
          db.exec(sql)
        } catch (err) {
          // A migration may open an explicit transaction (e.g. a table rebuild that
          // toggles PRAGMA foreign_keys). If it throws mid-way, better-sqlite3 leaves
          // that transaction open and can leave foreign_keys OFF. Roll back and restore
          // FK enforcement before rethrowing so startup aborts from a clean connection
          // state — nothing is recorded in _migrations, so the next launch retries.
          try {
            db.exec('ROLLBACK')
          } catch {
            // No transaction was open — nothing to roll back.
          }
          try {
            db.exec('PRAGMA foreign_keys = ON')
          } catch {
            // Best effort; the throw below is what matters.
          }
          throw err
        }
      }
      db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(file)
      console.log(`[db] Applied migration: ${file}`)
    }
  }
}
