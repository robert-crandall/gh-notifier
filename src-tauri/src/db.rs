use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

#[allow(clippy::module_name_repetitions)]
pub struct DbState(pub Mutex<Connection>);

pub fn init_db(app_data_dir: &Path) -> Result<Connection, String> {
  std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
  let db_path = app_data_dir.join("gh-notifier.db");
  let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
  migrate(&conn).map_err(|e| e.to_string())?;
  Ok(conn)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
  // Read the current schema version (0 = fresh database).
  let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

  if version < 1 {
    conn.execute_batch(
      "
      CREATE TABLE IF NOT EXISTS projects (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT    NOT NULL,
        context_doc  TEXT    NOT NULL DEFAULT '',
        next_action  TEXT    NOT NULL DEFAULT '',
        status       TEXT    NOT NULL DEFAULT 'active',
        snooze_mode  TEXT,
        snooze_until TEXT,
        icon         TEXT    NOT NULL DEFAULT 'folder',
        repo_label   TEXT    NOT NULL DEFAULT '',
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        github_id      TEXT    NOT NULL UNIQUE,
        repo_full_name TEXT    NOT NULL,
        subject_title  TEXT    NOT NULL,
        subject_type   TEXT    NOT NULL,
        subject_url    TEXT,
        reason         TEXT    NOT NULL,
        is_read        INTEGER NOT NULL DEFAULT 0,
        updated_at     TEXT    NOT NULL,
        project_id     INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        author         TEXT    NOT NULL DEFAULT '',
        author_avatar  TEXT
      );

      CREATE TABLE IF NOT EXISTS manual_tasks (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT    NOT NULL,
        is_done    INTEGER NOT NULL DEFAULT 0,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS thread_mappings (
        repo_full_name TEXT    NOT NULL,
        thread_id      TEXT    NOT NULL,
        project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        PRIMARY KEY (repo_full_name, thread_id)
      );

      PRAGMA user_version = 1;
      ",
    )?;
  }

  if version < 2 {
    // Add html_url column so we can store browser-friendly URLs from GitHub sync.
    conn.execute_batch(
      "ALTER TABLE notifications ADD COLUMN html_url TEXT;
       PRAGMA user_version = 2;",
    )?;
  }

  Ok(())
}
