import Database from 'better-sqlite3'
import { join } from 'path'
import { app } from 'electron'
import { runMigrations } from './migrate'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.')
  }
  return db
}

export function initDb(): void {
  const dbPath = join(app.getPath('userData'), 'gh-projects.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
}
