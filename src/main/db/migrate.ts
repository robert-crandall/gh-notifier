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
        db.exec(sql)
      }
      db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(file)
      console.log(`[db] Applied migration: ${file}`)
    }
  }
}
