#![allow(clippy::needless_pass_by_value)]
#![allow(clippy::missing_errors_doc)]

use crate::{
  db::{DbState, EncKey, TokenCache},
  github,
  models::{AppSettings, GithubNotification, ManualTask, Project},
};
use aes_gcm::{
  aead::{Aead, KeyInit},
  Aes256Gcm, Nonce,
};
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, OptionalExtension};

// ---------------------------------------------------------------------------
// Token encryption helpers (AES-256-GCM, key stored in key.bin)
// ---------------------------------------------------------------------------

fn to_hex(bytes: &[u8]) -> String {
  bytes
    .iter()
    .fold(String::with_capacity(bytes.len() * 2), |mut acc, b| {
      use std::fmt::Write as _;
      write!(acc, "{b:02x}").expect("writing to String is infallible");
      acc
    })
}

fn from_hex(s: &str) -> Result<Vec<u8>, String> {
  if !s.len().is_multiple_of(2) {
    return Err("invalid hex string length".into());
  }
  (0..s.len() / 2)
    .map(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).map_err(|e| e.to_string()))
    .collect()
}

fn encrypt_token(token: &str, key: &[u8; 32]) -> Result<String, String> {
  let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
  let mut nonce_bytes = [0u8; 12];
  OsRng.fill_bytes(&mut nonce_bytes);
  let nonce = Nonce::from_slice(&nonce_bytes);
  let ciphertext = cipher
    .encrypt(nonce, token.as_bytes())
    .map_err(|e| e.to_string())?;
  Ok(format!("{}:{}", to_hex(&nonce_bytes), to_hex(&ciphertext)))
}

fn decrypt_token(stored: &str, key: &[u8; 32]) -> Result<String, String> {
  let (nonce_hex, ct_hex) = stored
    .split_once(':')
    .ok_or("invalid encrypted token format")?;
  let nonce_bytes = from_hex(nonce_hex)?;
  let ciphertext = from_hex(ct_hex)?;
  let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
  let nonce_array: [u8; 12] = nonce_bytes
    .try_into()
    .map_err(|_| "invalid nonce length for encrypted token".to_string())?;
  let nonce = Nonce::from_slice(&nonce_array);
  let plaintext = cipher
    .decrypt(nonce, ciphertext.as_ref())
    .map_err(|_| "decryption failed — token may be corrupt".to_string())?;
  String::from_utf8(plaintext).map_err(|e| e.to_string())
}

/// Load the PAT from `SQLite` (AES-256-GCM encrypted) — used only once at startup.
/// All runtime code reads from `TokenCache` instead.
pub(crate) fn load_token_for_cache(conn: &rusqlite::Connection, key: &[u8; 32]) -> Option<String> {
  let encrypted: Option<String> = match conn
    .query_row(
      "SELECT value FROM settings WHERE key = 'github_token_enc'",
      [],
      |row| row.get(0),
    )
    .optional()
  {
    Ok(row_opt) => row_opt,
    Err(e) => {
      eprintln!("Failed to load encrypted GitHub token from SQLite: {e}");
      None
    }
  };

  encrypted.and_then(|enc| {
    decrypt_token(&enc, key)
      .map_err(|e| eprintln!("Failed to decrypt GitHub token: {e}"))
      .ok()
  })
}

// ---------------------------------------------------------------------------
// Row mapper helpers
// ---------------------------------------------------------------------------

// Columns: id, name, context_doc, next_action, status, snooze_mode,
//          snooze_until, icon, repo_label, unread_count
fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
  Ok(Project {
    id: row.get(0)?,
    name: row.get(1)?,
    context_doc: row.get(2)?,
    next_action: row.get(3)?,
    status: row.get(4)?,
    snooze_mode: row.get(5)?,
    snooze_until: row.get(6)?,
    icon: row.get(7)?,
    repo_label: row.get(8)?,
    unread_count: row.get(9)?,
  })
}

// Columns: id, github_id, repo_full_name, subject_title, subject_type,
//          subject_url, reason, is_read, updated_at, project_id, author, author_avatar, html_url
fn notification_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GithubNotification> {
  Ok(GithubNotification {
    id: row.get(0)?,
    github_id: row.get(1)?,
    repo_full_name: row.get(2)?,
    subject_title: row.get(3)?,
    subject_type: row.get(4)?,
    subject_url: row.get(5)?,
    reason: row.get(6)?,
    is_read: row.get(7)?,
    updated_at: row.get(8)?,
    project_id: row.get(9)?,
    author: row.get(10)?,
    author_avatar: row.get(11)?,
    html_url: row.get(12)?,
  })
}

// Columns: id, title, is_done, project_id
fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ManualTask> {
  Ok(ManualTask {
    id: row.get(0)?,
    title: row.get(1)?,
    is_done: row.get(2)?,
    project_id: row.get(3)?,
  })
}

// SQL fragment shared by project queries — includes unread_count via LEFT JOIN.
// Must be followed by GROUP BY p.id and an optional WHERE / ORDER BY.
const PROJECT_COLS: &str = "SELECT \
  p.id, p.name, p.context_doc, p.next_action, p.status, \
  p.snooze_mode, p.snooze_until, p.icon, p.repo_label, \
  COALESCE(SUM(CASE WHEN n.is_read = 0 THEN 1 ELSE 0 END), 0) AS unread_count \
  FROM projects p \
  LEFT JOIN notifications n ON n.project_id = p.id";

// ---------------------------------------------------------------------------
// Project commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_projects(state: tauri::State<'_, DbState>) -> Result<Vec<Project>, String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  let sql = format!("{PROJECT_COLS} GROUP BY p.id ORDER BY p.created_at");
  let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
  let result = stmt
    .query_map([], project_from_row)
    .map_err(|e| e.to_string())?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(|e| e.to_string());
  result
}

#[tauri::command]
pub fn get_project(id: i64, state: tauri::State<'_, DbState>) -> Result<Project, String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  let sql = format!("{PROJECT_COLS} WHERE p.id = ?1 GROUP BY p.id");
  db.query_row(&sql, params![id], project_from_row)
    .map_err(|_| format!("Project {id} not found"))
}

#[tauri::command]
pub fn create_project(name: String, state: tauri::State<'_, DbState>) -> Result<Project, String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute("INSERT INTO projects (name) VALUES (?1)", params![name])
    .map_err(|e| e.to_string())?;
  let id = db.last_insert_rowid();
  let sql = format!("{PROJECT_COLS} WHERE p.id = ?1 GROUP BY p.id");
  db.query_row(&sql, params![id], project_from_row)
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_project(project: Project, state: tauri::State<'_, DbState>) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute(
    "UPDATE projects \
     SET name = ?1, context_doc = ?2, next_action = ?3, icon = ?4, \
         repo_label = ?5, updated_at = datetime('now') \
     WHERE id = ?6",
    params![
      project.name,
      project.context_doc,
      project.next_action,
      project.icon,
      project.repo_label,
      project.id
    ],
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn delete_project(id: i64, state: tauri::State<'_, DbState>) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute("DELETE FROM projects WHERE id = ?1", params![id])
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn snooze_project(
  id: i64,
  mode: String,
  until: Option<String>,
  state: tauri::State<'_, DbState>,
) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute(
    "UPDATE projects \
     SET status = 'snoozed', snooze_mode = ?1, snooze_until = ?2, \
         updated_at = datetime('now') \
     WHERE id = ?3",
    params![mode, until, id],
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn wake_project(id: i64, state: tauri::State<'_, DbState>) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute(
    "UPDATE projects \
     SET status = 'active', snooze_mode = NULL, snooze_until = NULL, \
         updated_at = datetime('now') \
     WHERE id = ?1",
    params![id],
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}

// ---------------------------------------------------------------------------
// Notification commands
// ---------------------------------------------------------------------------

const NOTIFICATION_COLS: &str = "SELECT id, github_id, repo_full_name, subject_title, \
  subject_type, subject_url, reason, is_read, updated_at, project_id, author, author_avatar, \
  html_url FROM notifications";

#[tauri::command]
pub fn get_notifications(
  project_id: Option<i64>,
  state: tauri::State<'_, DbState>,
) -> Result<Vec<GithubNotification>, String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  if let Some(pid) = project_id {
    let sql = format!("{NOTIFICATION_COLS} WHERE project_id = ?1 ORDER BY updated_at DESC");
    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let result = stmt
      .query_map(params![pid], notification_from_row)
      .map_err(|e| e.to_string())?
      .collect::<rusqlite::Result<Vec<_>>>()
      .map_err(|e| e.to_string());
    result
  } else {
    let sql = format!("{NOTIFICATION_COLS} ORDER BY updated_at DESC");
    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let result = stmt
      .query_map([], notification_from_row)
      .map_err(|e| e.to_string())?
      .collect::<rusqlite::Result<Vec<_>>>()
      .map_err(|e| e.to_string());
    result
  }
}

#[tauri::command]
pub fn get_unmapped_notifications(
  state: tauri::State<'_, DbState>,
) -> Result<Vec<GithubNotification>, String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  let sql = format!(
    "{NOTIFICATION_COLS} WHERE project_id IS NULL AND is_read = 0 ORDER BY updated_at DESC"
  );
  let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
  let result = stmt
    .query_map([], notification_from_row)
    .map_err(|e| e.to_string())?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(|e| e.to_string());
  result
}

#[tauri::command]
pub fn assign_notification_to_project(
  notification_id: i64,
  project_id: i64,
  state: tauri::State<'_, DbState>,
) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;

  // Look up the notification's repo and thread id so we can persist the mapping.
  let (repo_full_name, github_id): (String, String) = db
    .query_row(
      "SELECT repo_full_name, github_id FROM notifications WHERE id = ?1",
      params![notification_id],
      |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .map_err(|_| format!("Notification {notification_id} not found"))?;

  // Assign the notification to the project.
  db.execute(
    "UPDATE notifications SET project_id = ?1 WHERE id = ?2",
    params![project_id, notification_id],
  )
  .map_err(|e| e.to_string())?;

  // Persist the thread→project mapping so future notifications from the same
  // thread are auto-routed without any user action.
  db.execute(
    "INSERT OR REPLACE INTO thread_mappings (repo_full_name, thread_id, project_id) \
     VALUES (?1, ?2, ?3)",
    params![repo_full_name, github_id, project_id],
  )
  .map_err(|e| e.to_string())?;

  Ok(())
}

#[tauri::command]
pub fn mark_notification_read(id: i64, state: tauri::State<'_, DbState>) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute(
    "UPDATE notifications SET is_read = 1 WHERE id = ?1",
    params![id],
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn unsubscribe_thread(
  id: i64,
  token_cache: tauri::State<'_, TokenCache>,
  state: tauri::State<'_, DbState>,
) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;

  // Fetch the github_id needed to call the GitHub API.
  let github_id: String = db
    .query_row(
      "SELECT github_id FROM notifications WHERE id = ?1",
      params![id],
      |row| row.get(0),
    )
    .map_err(|_| format!("Notification {id} not found"))?;

  // Call the GitHub API if a token is configured.  If there is no token the
  // notification was created manually / before setup — just mark it read.
  if let Ok(token_guard) = token_cache.0.lock() {
    if let Some(token) = token_guard.as_deref() {
      github::unsubscribe_thread(token, &github_id)?;
    }
  }

  db.execute(
    "UPDATE notifications SET is_read = 1 WHERE id = ?1",
    params![id],
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}

// ---------------------------------------------------------------------------
// Settings commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(
  token_cache: tauri::State<'_, TokenCache>,
  state: tauri::State<'_, DbState>,
) -> Result<AppSettings, String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;

  // Read the PAT from the in-memory cache — never from Keychain at runtime.
  let github_token = token_cache.0.lock().map_err(|e| e.to_string())?.clone();

  let poll_interval_minutes = db
    .query_row(
      "SELECT value FROM settings WHERE key = 'poll_interval_minutes'",
      [],
      |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| e.to_string())?
    .and_then(|v| v.parse::<i64>().ok())
    .unwrap_or(5);

  let is_setup_complete = db
    .query_row(
      "SELECT value FROM settings WHERE key = 'is_setup_complete'",
      [],
      |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| e.to_string())?
    .is_some_and(|v| v == "true");

  let last_synced_at = db
    .query_row(
      "SELECT value FROM settings WHERE key = 'last_synced_at'",
      [],
      |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  Ok(AppSettings {
    github_token,
    poll_interval_minutes,
    is_setup_complete,
    last_synced_at,
  })
}

#[tauri::command]
pub fn save_settings(
  poll_interval_minutes: i64,
  state: tauri::State<'_, DbState>,
) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('poll_interval_minutes', ?1)",
    params![poll_interval_minutes.to_string()],
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn save_github_token(
  token: String,
  token_cache: tauri::State<'_, TokenCache>,
  state: tauri::State<'_, DbState>,
  enc_key: tauri::State<'_, EncKey>,
) -> Result<(), String> {
  // Validate before storing — fail fast with a useful error message.
  github::validate_token(&token)?;

  // Encrypt the PAT with AES-256-GCM and store it in SQLite.
  let encrypted = encrypt_token(&token, &enc_key.0)?;
  {
    let mut db = state.0.lock().map_err(|e| e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token_enc', ?1)",
      params![encrypted],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('is_setup_complete', 'true')",
      [],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
  }

  // Update the in-memory cache so subsequent calls don't re-read SQLite.
  *token_cache.0.lock().map_err(|e| e.to_string())? = Some(token);

  Ok(())
}

// ---------------------------------------------------------------------------
// Sync helpers
// ---------------------------------------------------------------------------

fn get_cached_token(cache: &TokenCache) -> Result<String, String> {
  cache
    .0
    .lock()
    .map_err(|e| e.to_string())?
    .clone()
    .ok_or_else(|| "No GitHub token configured. Please complete setup first.".to_string())
}

/// Core sync logic — upsert API notifications into the DB, wake notification-mode
/// snoozed projects, wake expired date-based snoozes, and record `last_synced_at`.
/// Called by both the Tauri command and the background polling loop.
fn process_notifications(
  db: &rusqlite::Connection,
  api_notifications: &[github::ApiNotification],
) -> Result<(), String> {
  for n in api_notifications {
    // Filter out team_mention noise per the PRD.
    if n.reason == "team_mention" {
      continue;
    }

    let html_url = n
      .subject
      .url
      .as_deref()
      .and_then(github::api_url_to_html_url);

    // Check thread_mappings to auto-assign project_id for this notification.
    let mapped_project_id: Option<i64> = db
      .query_row(
        "SELECT project_id FROM thread_mappings \
         WHERE repo_full_name = ?1 AND thread_id = ?2",
        params![n.repository.full_name, n.id],
        |row| row.get(0),
      )
      .optional()
      .map_err(|e| e.to_string())?;

    db.execute(
      "INSERT INTO notifications \
         (github_id, repo_full_name, subject_title, subject_type, subject_url, \
          reason, is_read, updated_at, html_url, project_id) \
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) \
       ON CONFLICT(github_id) DO UPDATE SET \
         repo_full_name = excluded.repo_full_name, \
         subject_title  = excluded.subject_title, \
         subject_type   = excluded.subject_type, \
         subject_url    = excluded.subject_url, \
         reason         = excluded.reason, \
         is_read        = CASE WHEN excluded.is_read = 0 THEN 0 ELSE notifications.is_read END, \
         updated_at     = excluded.updated_at, \
         html_url       = excluded.html_url, \
         project_id     = COALESCE(notifications.project_id, excluded.project_id)",
      params![
        n.id,
        n.repository.full_name,
        n.subject.title,
        n.subject.subject_type,
        n.subject.url,
        n.reason,
        !n.unread, // GitHub "unread" = true  →  our is_read = false
        n.updated_at,
        html_url,
        mapped_project_id,
      ],
    )
    .map_err(|e| e.to_string())?;

    // Wake the project this notification is actually assigned to (if any).
    // We look up the effective project_id after the upsert, to account for
    // cases where an existing notifications.project_id was preserved by
    // COALESCE(notifications.project_id, excluded.project_id).
    let effective_project_id: Option<i64> = db
      .query_row(
        "SELECT project_id FROM notifications \
         WHERE github_id = ?1 AND project_id IS NOT NULL",
        params![n.id],
        |row| row.get(0),
      )
      .optional()
      .map_err(|e| e.to_string())?;

    // If the notification is assigned to a snoozed project with
    // snooze_mode = 'notification', wake that project now.
    if let Some(pid) = effective_project_id {
      db.execute(
        "UPDATE projects \
         SET status = 'active', snooze_mode = NULL, snooze_until = NULL, \
             updated_at = datetime('now') \
         WHERE id = ?1 AND status = 'snoozed' AND snooze_mode = 'notification'",
        params![pid],
      )
      .map_err(|e| e.to_string())?;
    }
  }

  // Wake any date-based snoozed projects whose deadline has passed.
  db.execute(
    "UPDATE projects \
     SET status = 'active', snooze_mode = NULL, snooze_until = NULL, \
         updated_at = datetime('now') \
     WHERE status = 'snoozed' AND snooze_mode = 'date' \
       AND snooze_until IS NOT NULL AND datetime(snooze_until) <= datetime('now')",
    [],
  )
  .map_err(|e| e.to_string())?;

  // Record when the last successful sync completed.
  db.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('last_synced_at', datetime('now'))",
    [],
  )
  .map_err(|e| e.to_string())?;

  Ok(())
}

/// Entry point for the background polling task. Gets the token from the in-memory
/// cache — never touches the Keychain.
pub(crate) fn background_sync(
  db_state: &crate::db::DbState,
  token_cache: &crate::db::TokenCache,
) -> Result<(), String> {
  let token = get_cached_token(token_cache)?;
  let api_notifications = github::fetch_notifications(&token)?; // no DB lock held
  let db = db_state.0.lock().map_err(|e| e.to_string())?;
  process_notifications(&db, &api_notifications)
}

#[tauri::command]
pub fn sync_notifications(
  token_cache: tauri::State<'_, TokenCache>,
  state: tauri::State<'_, DbState>,
) -> Result<(), String> {
  let token = get_cached_token(&token_cache)?;
  let api_notifications = github::fetch_notifications(&token)?; // no DB lock held
  let db = state.0.lock().map_err(|e| e.to_string())?;
  process_notifications(&db, &api_notifications)
}

// ---------------------------------------------------------------------------
// Manual task commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_manual_tasks(
  project_id: Option<i64>,
  state: tauri::State<'_, DbState>,
) -> Result<Vec<ManualTask>, String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  if let Some(pid) = project_id {
    let mut stmt = db
      .prepare(
        "SELECT id, title, is_done, project_id FROM manual_tasks \
         WHERE project_id = ?1",
      )
      .map_err(|e| e.to_string())?;
    let result = stmt
      .query_map(params![pid], task_from_row)
      .map_err(|e| e.to_string())?
      .collect::<rusqlite::Result<Vec<_>>>()
      .map_err(|e| e.to_string());
    result
  } else {
    let mut stmt = db
      .prepare("SELECT id, title, is_done, project_id FROM manual_tasks")
      .map_err(|e| e.to_string())?;
    let result = stmt
      .query_map([], task_from_row)
      .map_err(|e| e.to_string())?
      .collect::<rusqlite::Result<Vec<_>>>()
      .map_err(|e| e.to_string());
    result
  }
}

#[tauri::command]
pub fn create_manual_task(
  title: String,
  project_id: Option<i64>,
  state: tauri::State<'_, DbState>,
) -> Result<ManualTask, String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute(
    "INSERT INTO manual_tasks (title, project_id) VALUES (?1, ?2)",
    params![title, project_id],
  )
  .map_err(|e| e.to_string())?;
  let id = db.last_insert_rowid();
  db.query_row(
    "SELECT id, title, is_done, project_id FROM manual_tasks WHERE id = ?1",
    params![id],
    task_from_row,
  )
  .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_manual_task(id: i64, state: tauri::State<'_, DbState>) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute(
    "UPDATE manual_tasks SET is_done = NOT is_done WHERE id = ?1",
    params![id],
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn delete_manual_task(id: i64, state: tauri::State<'_, DbState>) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute("DELETE FROM manual_tasks WHERE id = ?1", params![id])
    .map_err(|e| e.to_string())?;
  Ok(())
}

// ---------------------------------------------------------------------------
// Thread-mapping unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
  use rusqlite::{params, Connection, OptionalExtension};

  /// Open an in-memory SQLite database with the full production schema applied.
  fn test_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn
      .execute_batch(
        "
        CREATE TABLE projects (
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
        CREATE TABLE notifications (
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
          author_avatar  TEXT,
          html_url       TEXT
        );
        CREATE TABLE thread_mappings (
          repo_full_name TEXT    NOT NULL,
          thread_id      TEXT    NOT NULL,
          project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          PRIMARY KEY (repo_full_name, thread_id)
        );
        ",
      )
      .unwrap();
    conn
  }

  /// Seed a project and return its id.
  fn insert_project(db: &Connection, name: &str) -> i64 {
    db.execute("INSERT INTO projects (name) VALUES (?1)", params![name])
      .unwrap();
    db.last_insert_rowid()
  }

  /// Seed a bare notification (no project_id) and return its id.
  fn insert_notification(db: &Connection, github_id: &str, repo: &str) -> i64 {
    db.execute(
      "INSERT INTO notifications \
       (github_id, repo_full_name, subject_title, subject_type, reason, updated_at) \
       VALUES (?1, ?2, 'Test notification', 'Issue', 'mention', '2024-01-01T00:00:00Z')",
      params![github_id, repo],
    )
    .unwrap();
    db.last_insert_rowid()
  }

  // Replicates the SQL used by `assign_notification_to_project`.
  fn assign(db: &Connection, notification_id: i64, project_id: i64) {
    let (repo_full_name, github_id): (String, String) = db
      .query_row(
        "SELECT repo_full_name, github_id FROM notifications WHERE id = ?1",
        params![notification_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
      )
      .unwrap();
    db.execute(
      "UPDATE notifications SET project_id = ?1 WHERE id = ?2",
      params![project_id, notification_id],
    )
    .unwrap();
    db.execute(
      "INSERT OR REPLACE INTO thread_mappings (repo_full_name, thread_id, project_id) \
       VALUES (?1, ?2, ?3)",
      params![repo_full_name, github_id, project_id],
    )
    .unwrap();
  }

  // Replicates the upsert + wake logic from `sync_notifications` for one notification.
  fn sync_one(
    db: &Connection,
    github_id: &str,
    repo: &str,
    is_unread: bool,
    mapped_project_id: Option<i64>,
  ) {
    db.execute(
      "INSERT INTO notifications \
         (github_id, repo_full_name, subject_title, subject_type, reason, \
          is_read, updated_at, project_id) \
       VALUES (?1, ?2, 'Updated title', 'Issue', 'mention', ?3, '2024-02-01T00:00:00Z', ?4) \
       ON CONFLICT(github_id) DO UPDATE SET \
         subject_title = excluded.subject_title, \
         is_read       = CASE WHEN excluded.is_read = 0 THEN 0 ELSE notifications.is_read END, \
         updated_at    = excluded.updated_at, \
         project_id    = COALESCE(notifications.project_id, excluded.project_id)",
      params![github_id, repo, !is_unread, mapped_project_id],
    )
    .unwrap();

    let effective_project_id: Option<i64> = db
      .query_row(
        "SELECT project_id FROM notifications \
         WHERE github_id = ?1 AND project_id IS NOT NULL",
        params![github_id],
        |row| row.get(0),
      )
      .optional()
      .unwrap();

    if let Some(pid) = effective_project_id {
      db.execute(
        "UPDATE projects \
         SET status = 'active', snooze_mode = NULL, snooze_until = NULL, \
             updated_at = datetime('now') \
         WHERE id = ?1 AND status = 'snoozed' AND snooze_mode = 'notification'",
        params![pid],
      )
      .unwrap();
    }
  }

  #[test]
  fn assign_saves_thread_mapping() {
    let db = test_db();
    let pid = insert_project(&db, "My Project");
    let nid = insert_notification(&db, "thread-1", "org/repo");

    assign(&db, nid, pid);

    let mapped: Option<i64> = db
      .query_row(
        "SELECT project_id FROM thread_mappings \
         WHERE repo_full_name = 'org/repo' AND thread_id = 'thread-1'",
        [],
        |row| row.get(0),
      )
      .optional()
      .unwrap();
    assert_eq!(mapped, Some(pid));
  }

  #[test]
  fn assign_updates_notification_project_id() {
    let db = test_db();
    let pid = insert_project(&db, "My Project");
    let nid = insert_notification(&db, "thread-2", "org/repo");

    assign(&db, nid, pid);

    let project_id: Option<i64> = db
      .query_row(
        "SELECT project_id FROM notifications WHERE id = ?1",
        params![nid],
        |row| row.get(0),
      )
      .optional()
      .unwrap()
      .flatten();
    assert_eq!(project_id, Some(pid));
  }

  #[test]
  fn sync_auto_routes_via_thread_mapping() {
    let db = test_db();
    let pid = insert_project(&db, "Auto Route Project");

    // Pre-seed a mapping: any notification from thread-3 → pid.
    db.execute(
      "INSERT INTO thread_mappings (repo_full_name, thread_id, project_id) VALUES (?1, ?2, ?3)",
      params!["org/repo", "thread-3", pid],
    )
    .unwrap();

    sync_one(&db, "thread-3", "org/repo", true, Some(pid));

    let project_id: Option<i64> = db
      .query_row(
        "SELECT project_id FROM notifications WHERE github_id = 'thread-3'",
        [],
        |row| row.get(0),
      )
      .optional()
      .unwrap()
      .flatten();
    assert_eq!(project_id, Some(pid));
  }

  #[test]
  fn sync_does_not_overwrite_existing_assignment() {
    let db = test_db();
    let pid_original = insert_project(&db, "Original Project");
    let pid_other = insert_project(&db, "Other Project");
    let nid = insert_notification(&db, "thread-4", "org/repo");

    // Manually assign the notification to pid_original.
    db.execute(
      "UPDATE notifications SET project_id = ?1 WHERE id = ?2",
      params![pid_original, nid],
    )
    .unwrap();

    // Sync arrives carrying a mapping to pid_other — should not overwrite.
    sync_one(&db, "thread-4", "org/repo", true, Some(pid_other));

    let project_id: Option<i64> = db
      .query_row(
        "SELECT project_id FROM notifications WHERE github_id = 'thread-4'",
        [],
        |row| row.get(0),
      )
      .optional()
      .unwrap()
      .flatten();
    assert_eq!(project_id, Some(pid_original));
  }

  #[test]
  fn sync_wakes_notification_snoozed_project() {
    let db = test_db();
    let pid = insert_project(&db, "Sleeping Project");

    // Put project into notification-based snooze.
    db.execute(
      "UPDATE projects SET status = 'snoozed', snooze_mode = 'notification' WHERE id = ?1",
      params![pid],
    )
    .unwrap();

    sync_one(&db, "thread-5", "org/repo", true, Some(pid));

    let status: String = db
      .query_row(
        "SELECT status FROM projects WHERE id = ?1",
        params![pid],
        |row| row.get(0),
      )
      .unwrap();
    assert_eq!(status, "active");
  }

  #[test]
  fn sync_does_not_wake_date_snoozed_project() {
    let db = test_db();
    let pid = insert_project(&db, "Date-Snoozed Project");

    // snooze_mode = 'date' — should NOT be woken by an incoming notification.
    db.execute(
      "UPDATE projects \
       SET status = 'snoozed', snooze_mode = 'date', snooze_until = '2099-12-31' \
       WHERE id = ?1",
      params![pid],
    )
    .unwrap();

    sync_one(&db, "thread-6", "org/repo", true, Some(pid));

    let status: String = db
      .query_row(
        "SELECT status FROM projects WHERE id = ?1",
        params![pid],
        |row| row.get(0),
      )
      .unwrap();
    assert_eq!(status, "snoozed");
  }

  // ---------------------------------------------------------------------------
  // AES-256-GCM encryption/decryption unit tests
  // ---------------------------------------------------------------------------

  #[test]
  fn test_encrypt_decrypt_round_trip() {
    use super::{decrypt_token, encrypt_token};
    let key = [42u8; 32];
    let token = "ghp_testtoken1234567890";

    let encrypted = encrypt_token(token, &key).expect("encryption should succeed");
    let decrypted = decrypt_token(&encrypted, &key).expect("decryption should succeed");

    assert_eq!(decrypted, token);
  }

  #[test]
  fn test_decrypt_invalid_format() {
    use super::decrypt_token;
    let key = [42u8; 32];

    // Missing the ':' separator
    let result = decrypt_token("badhex", &key);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), "invalid encrypted token format");
  }

  #[test]
  fn test_decrypt_invalid_nonce_length() {
    use super::decrypt_token;
    let key = [42u8; 32];

    // Valid hex but wrong nonce length (8 bytes instead of 12)
    let result = decrypt_token("0102030405060708:abcdef", &key);
    assert!(result.is_err());
    assert_eq!(
      result.unwrap_err(),
      "invalid nonce length for encrypted token"
    );
  }

  #[test]
  fn test_decrypt_corrupted_ciphertext() {
    use super::{decrypt_token, encrypt_token};
    let key = [42u8; 32];

    let encrypted = encrypt_token("ghp_test", &key).expect("encryption should succeed");
    let (nonce_hex, _) = encrypted.split_once(':').unwrap();

    // Replace ciphertext with garbage (but valid hex)
    let corrupted = format!("{nonce_hex}:deadbeef");
    let result = decrypt_token(&corrupted, &key);

    assert!(result.is_err());
    assert_eq!(
      result.unwrap_err(),
      "decryption failed — token may be corrupt"
    );
  }

  #[test]
  fn test_decrypt_wrong_key() {
    use super::{decrypt_token, encrypt_token};
    let key1 = [1u8; 32];
    let key2 = [2u8; 32];

    let encrypted = encrypt_token("ghp_test", &key1).expect("encryption should succeed");
    let result = decrypt_token(&encrypted, &key2);

    assert!(result.is_err());
    assert_eq!(
      result.unwrap_err(),
      "decryption failed — token may be corrupt"
    );
  }
}
