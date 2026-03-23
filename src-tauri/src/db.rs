use rand::{rngs::OsRng, RngCore};
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

#[allow(clippy::module_name_repetitions)]
pub struct DbState(pub Mutex<Connection>);

/// In-memory PAT cache so commands never hit the encrypted store more than once
/// per app launch.
pub struct TokenCache(pub Mutex<Option<String>>);

/// The 256-bit AES-GCM key used to encrypt the GitHub PAT at rest in `SQLite`.
/// Loaded once at startup from `<app_data_dir>/key.bin`.
pub struct EncKey(pub [u8; 32]);

/// Load the encryption key from `<app_data_dir>/key.bin`, generating and
/// persisting a fresh random key on first launch.  The file is created with
/// mode 0o600 (owner read/write only) on Unix systems.
pub fn load_or_create_key(app_data_dir: &Path) -> Result<[u8; 32], String> {
  std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
  let key_path = app_data_dir.join("key.bin");

  if key_path.exists() {
    let bytes = std::fs::read(&key_path).map_err(|e| e.to_string())?;
    bytes
      .try_into()
      .map_err(|_| "key.bin is corrupt (wrong length — delete it to reset)".into())
  } else {
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    write_key_file(&key_path, &key)?;
    Ok(key)
  }
}

#[cfg(unix)]
fn write_key_file(path: &Path, key: &[u8]) -> Result<(), String> {
  use std::io::Write as _;
  use std::os::unix::fs::OpenOptionsExt as _;
  let mut file = std::fs::OpenOptions::new()
    .write(true)
    .create_new(true)
    .mode(0o600)
    .open(path)
    .map_err(|e| e.to_string())?;
  file.write_all(key).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn write_key_file(path: &Path, key: &[u8]) -> Result<(), String> {
  // SECURITY NOTE: On Windows and other non-Unix platforms, this writes key.bin
  // without enforcing restrictive file permissions. The key is the sole protection
  // for decrypting `github_token_enc` in SQLite. For production use, consider:
  // - Using platform-specific secure storage (DPAPI on Windows, Keychain on macOS, libsecret on Linux)
  // - Applying restrictive ACLs after file creation (e.g., via Windows API)
  // - Documenting that users should not share their app data directory
  std::fs::write(path, key).map_err(|e| e.to_string())
}

pub fn init_db(app_data_dir: &Path) -> Result<Connection, String> {
  std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
  let db_path = app_data_dir.join("gh-notifier.db");
  let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

  // Enable foreign key enforcement so cascades and constraints apply.
  conn
    .execute("PRAGMA foreign_keys = ON", [])
    .map_err(|e| e.to_string())?;

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

  if version < 3 {
    // Add repo_rules table for repo-level routing rules.
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS repo_rules (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_full_name TEXT    NOT NULL UNIQUE,
        project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      PRAGMA user_version = 3;",
    )?;
  }

  if version < 4 {
    // Add is_terminal to track closed/merged threads — they are auto-read and
    // shown in a collapsed "Closed" section rather than the active thread list.
    conn.execute_batch(
      "ALTER TABLE notifications ADD COLUMN is_terminal INTEGER NOT NULL DEFAULT 0;
       PRAGMA user_version = 4;",
    )?;
  }

  if version < 5 {
    // Add bookmarks table for per-project named links.
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS bookmarks (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name       TEXT    NOT NULL,
        url        TEXT    NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      PRAGMA user_version = 5;",
    )?;
  }

  Ok(())
}
