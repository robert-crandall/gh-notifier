#![allow(clippy::needless_pass_by_value)]
#![allow(clippy::missing_errors_doc)]

use crate::{
  db::{CopilotTokenCache, DbState, EncKey, SyncState, TokenCache},
  github,
  models::{
    AppSettings, Bookmark, GithubNotification, GlobalFilter, ManualTask, Project, RepoFilter,
    RepoRoutingHint, RepoRoutingKind, RepoRule,
  },
};
use aes_gcm::{
  aead::{Aead, KeyInit},
  Aes256Gcm, Nonce,
};
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, OptionalExtension};
use tauri::{Emitter as _, Manager as _};

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

fn validate_copilot_token(token: &str) -> Result<(), String> {
  let client = reqwest::blocking::Client::builder()
    .build()
    .map_err(|e| e.to_string())?;
  let resp = client
    .get("https://models.github.ai/inference/models")
    .header("Authorization", format!("Bearer {token}"))
    .header("User-Agent", "gh-notifier/0.1")
    .send()
    .map_err(|e| format!("Network error validating Copilot token: {e}"))?;

  if resp.status().is_success() {
    Ok(())
  } else if resp.status().as_u16() == 401 {
    Err("Invalid Copilot token: GitHub Models returned 401 Unauthorized. Check the PAT and its scopes.".into())
  } else {
    Err(format!("GitHub Models returned status {}", resp.status()))
  }
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

/// Load the Copilot token from `SQLite` (AES-256-GCM encrypted) — used only once at startup.
pub(crate) fn load_copilot_token_for_cache(
  conn: &rusqlite::Connection,
  key: &[u8; 32],
) -> Option<String> {
  let encrypted: Option<String> = match conn
    .query_row(
      "SELECT value FROM settings WHERE key = 'copilot_token_enc'",
      [],
      |row| row.get(0),
    )
    .optional()
  {
    Ok(row_opt) => row_opt,
    Err(e) => {
      eprintln!("Failed to load encrypted Copilot token from SQLite: {e}");
      None
    }
  };

  encrypted.and_then(|enc| {
    decrypt_token(&enc, key)
      .map_err(|e| eprintln!("Failed to decrypt Copilot token: {e}"))
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
//          subject_url, reason, is_read, updated_at, project_id, author, author_avatar, html_url,
//          is_terminal, comment_body, comment_author, comment_avatar, comment_at, action_needed
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
    is_terminal: row.get(13)?,
    comment_body: row.get(14)?,
    comment_author: row.get(15)?,
    comment_avatar: row.get(16)?,
    comment_at: row.get(17)?,
    action_needed: row.get(18)?,
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
// Terminal notifications are excluded from the unread count.
// Must be followed by GROUP BY p.id and an optional WHERE / ORDER BY.
const PROJECT_COLS: &str = "SELECT \
  p.id, p.name, p.context_doc, p.next_action, p.status, \
  p.snooze_mode, p.snooze_until, p.icon, p.repo_label, \
  COALESCE(SUM(CASE WHEN n.is_read = 0 AND n.is_terminal = 0 THEN 1 ELSE 0 END), 0) AS unread_count \
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
pub fn delete_project(
  id: i64,
  reassign_to: Option<i64>,
  state: tauri::State<'_, DbState>,
) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;

  // Wrap UPDATE and DELETE in a single transaction for atomicity
  db.execute("BEGIN TRANSACTION", params![])
    .map_err(|e| e.to_string())?;

  let result = (|| {
    if let Some(target_id) = reassign_to {
      db.execute(
        "UPDATE notifications SET project_id = ?1 WHERE project_id = ?2",
        params![target_id, id],
      )
      .map_err(|e| e.to_string())?;
    }
    db.execute("DELETE FROM projects WHERE id = ?1", params![id])
      .map_err(|e| e.to_string())?;
    Ok(())
  })();

  match result {
    Ok(()) => {
      db.execute("COMMIT", params![]).map_err(|e| e.to_string())?;
      Ok(())
    }
    Err(e) => {
      db.execute("ROLLBACK", params![]).ok();
      Err(e)
    }
  }
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
  html_url, is_terminal, comment_body, comment_author, comment_avatar, comment_at, action_needed \
  FROM notifications";

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
) -> Result<RepoRoutingHint, String> {
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

  // If a repo rule already exists for this repo, no offer is needed.
  let rule_exists: bool = db
    .query_row(
      "SELECT 1 FROM repo_rules WHERE repo_full_name = ?1",
      params![repo_full_name],
      |_| Ok(true),
    )
    .optional()
    .map_err(|e| e.to_string())?
    .is_some();

  if rule_exists {
    return Ok(RepoRoutingHint {
      kind: RepoRoutingKind::None,
      repo_full_name,
      project_id,
      project_name: String::new(),
      existing_thread_count: 0,
      inbox_notification_count: 0,
    });
  }

  let project_name: String = db
    .query_row(
      "SELECT name FROM projects WHERE id = ?1",
      params![project_id],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())?;

  // Query other thread_mappings for this repo, excluding the one just inserted.
  let other_project_ids: Vec<i64> = {
    let mut stmt = db
      .prepare(
        "SELECT project_id FROM thread_mappings \
         WHERE repo_full_name = ?1 AND thread_id != ?2",
      )
      .map_err(|e| e.to_string())?;
    let rows = stmt
      .query_map(params![repo_full_name, github_id], |row| row.get(0))
      .map_err(|e| e.to_string())?
      .collect::<rusqlite::Result<Vec<_>>>()
      .map_err(|e| e.to_string())?;
    rows
  };

  let kind = if other_project_ids.is_empty() {
    // No prior threads from this repo — offer an opt-in repo rule.
    RepoRoutingKind::OptIn
  } else if other_project_ids.iter().all(|&pid| pid == project_id) {
    // All prior threads already route to the same project — offer opt-out.
    RepoRoutingKind::OptOut
  } else {
    // Threads split across multiple projects — no offer.
    RepoRoutingKind::None
  };

  let existing_thread_count = i64::try_from(other_project_ids.len()).unwrap_or(0);

  // Count unmapped inbox notifications from the same repo (excluding the one
  // just assigned, which now has project_id set).
  let inbox_notification_count: i64 = db
    .query_row(
      "SELECT COUNT(*) FROM notifications \
       WHERE repo_full_name = ?1 AND project_id IS NULL",
      params![repo_full_name],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())?;

  Ok(RepoRoutingHint {
    kind,
    repo_full_name,
    project_id,
    project_name,
    existing_thread_count,
    inbox_notification_count,
  })
}

#[tauri::command]
pub fn create_repo_rule(
  repo_full_name: String,
  project_id: i64,
  migrate_existing_threads: bool,
  state: tauri::State<'_, DbState>,
) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;

  // Wrap all statements in a transaction for atomicity.
  let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;

  tx.execute(
    "INSERT INTO repo_rules (repo_full_name, project_id) VALUES (?1, ?2) \
     ON CONFLICT(repo_full_name) DO UPDATE SET project_id = excluded.project_id",
    params![repo_full_name, project_id],
  )
  .map_err(|e| e.to_string())?;

  // Always route inbox notifications for this repo — assigning for the first
  // time is non-destructive and is exactly what the rule promises.
  tx.execute(
    "UPDATE notifications SET project_id = ?1 \
     WHERE repo_full_name = ?2 AND project_id IS NULL",
    params![project_id, repo_full_name],
  )
  .map_err(|e| e.to_string())?;

  if migrate_existing_threads {
    // Also reassign already-mapped threads and remove their thread-level entries.
    tx.execute(
      "UPDATE notifications SET project_id = ?1 \
       WHERE repo_full_name = ?2 AND project_id != ?1",
      params![project_id, repo_full_name],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
      "DELETE FROM thread_mappings WHERE repo_full_name = ?1",
      params![repo_full_name],
    )
    .map_err(|e| e.to_string())?;
  }

  tx.commit().map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn mark_notification_read(
  id: i64,
  token_cache: tauri::State<'_, TokenCache>,
  state: tauri::State<'_, DbState>,
) -> Result<(), String> {
  // Fetch the github_id so we can tell GitHub this thread is read.
  let github_id: Option<String> = {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.query_row(
      "SELECT github_id FROM notifications WHERE id = ?1",
      params![id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?
  };

  // Take a copy of the token so we don't hold the token cache lock during the network call.
  let token: Option<String> = if let Ok(token_guard) = token_cache.0.lock() {
    token_guard.as_deref().map(str::to_owned)
  } else {
    None
  };

  // Tell GitHub the thread is read so it won't resurface on the next sync.
  // Best-effort: if there's no token or the API call fails, still mark read locally.
  if let (Some(gid), Some(token)) = (github_id.as_ref(), token.as_ref()) {
    let _ = github::mark_thread_read(token, gid);
  }

  {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
      "UPDATE notifications SET is_read = 1 WHERE id = ?1",
      params![id],
    )
    .map_err(|e| e.to_string())?;
  }
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

#[tauri::command]
pub fn mark_notification_unread(id: i64, state: tauri::State<'_, DbState>) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute(
    "UPDATE notifications SET is_read = 0 WHERE id = ?1 AND is_terminal = 0",
    params![id],
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn set_action_needed(
  id: i64,
  action_needed: bool,
  state: tauri::State<'_, DbState>,
) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute(
    "UPDATE notifications SET action_needed = ?1 WHERE id = ?2",
    params![action_needed, id],
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn mark_all_notifications_read(
  project_id: Option<i64>,
  token_cache: tauri::State<'_, TokenCache>,
  state: tauri::State<'_, DbState>,
) -> Result<(), String> {
  // Fetch all unread notification IDs and their github_ids.
  let notifications: Vec<(i64, Option<String>)> = {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(pid) = project_id {
      let mut stmt = db
        .prepare("SELECT id, github_id FROM notifications WHERE project_id = ?1 AND is_read = 0")
        .map_err(|e| e.to_string())?;
      let rows = stmt
        .query_map(params![pid], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?;
      rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    } else {
      let mut stmt = db
        .prepare("SELECT id, github_id FROM notifications WHERE project_id IS NULL AND is_read = 0")
        .map_err(|e| e.to_string())?;
      let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?;
      rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    }
  };

  // Take a copy of the token so we don't hold the lock during network calls.
  let token: Option<String> = if let Ok(token_guard) = token_cache.0.lock() {
    token_guard.as_deref().map(str::to_owned)
  } else {
    None
  };

  // Best-effort: tell GitHub each thread is read.
  if let Some(token) = token.as_ref() {
    for (_id, github_id) in &notifications {
      if let Some(gid) = github_id {
        let _ = github::mark_thread_read(token, gid);
      }
    }
  }

  // Mark all as read in the database for the exact rows we fetched above.
  {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    for (id, _github_id) in &notifications {
      db.execute(
        "UPDATE notifications SET is_read = 1 WHERE id = ?1 AND is_read = 0",
        params![id],
      )
      .map_err(|e| e.to_string())?;
    }
  }
  Ok(())
}

// ---------------------------------------------------------------------------
// Settings commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(
  token_cache: tauri::State<'_, TokenCache>,
  copilot_cache: tauri::State<'_, CopilotTokenCache>,
  state: tauri::State<'_, DbState>,
) -> Result<AppSettings, String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;

  // Read the PAT from the in-memory cache — never from Keychain at runtime.
  let github_token = token_cache.0.lock().map_err(|e| e.to_string())?.clone();
  let copilot_token = copilot_cache.0.lock().map_err(|e| e.to_string())?.clone();

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
    copilot_token,
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
pub fn save_copilot_token(
  token: String,
  copilot_cache: tauri::State<'_, CopilotTokenCache>,
  state: tauri::State<'_, DbState>,
  enc_key: tauri::State<'_, EncKey>,
) -> Result<(), String> {
  validate_copilot_token(&token)?;
  let encrypted = encrypt_token(&token, &enc_key.0)?;
  {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('copilot_token_enc', ?1)",
      params![encrypted],
    )
    .map_err(|e| e.to_string())?;
  }
  *copilot_cache.0.lock().map_err(|e| e.to_string())? = Some(token);
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
///
/// Enriches `api_notifications` with terminal state checks **before** acquiring the DB
/// lock to avoid blocking other commands during network I/O. Reuses a single HTTP
/// client for all terminal-state fetches to reduce overhead.
#[allow(clippy::too_many_lines)]
fn process_notifications(
  db: &rusqlite::Connection,
  api_notifications: &[github::ApiNotification],
  token: &str,
) -> Result<(), String> {
  // Build HTTP client once for all terminal-state checks.
  let client = github::make_client_public(token)?;

  // Load all global filters into a HashSet for fast lookups
  let global_filters: std::collections::HashSet<String> = {
    let mut stmt = db
      .prepare("SELECT reason FROM global_filters")
      .map_err(|e| e.to_string())?;
    let rows = stmt
      .query_map([], |row| row.get::<_, String>(0))
      .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
  };

  // Load all repo filters into a map: repo_full_name -> set of reasons
  let repo_filters: std::collections::HashMap<String, std::collections::HashSet<String>> = {
    let mut stmt = db
      .prepare("SELECT repo_full_name, reason FROM repo_filters")
      .map_err(|e| e.to_string())?;
    let rows = stmt
      .query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
      })
      .map_err(|e| e.to_string())?;

    let mut map: std::collections::HashMap<String, std::collections::HashSet<String>> =
      std::collections::HashMap::new();
    for row_result in rows {
      let (repo, reason) = row_result.map_err(|e| e.to_string())?;
      map.entry(repo).or_default().insert(reason);
    }
    map
  };

  for n in api_notifications {
    // Check if this notification should be filtered using in-memory lookups
    let is_globally_filtered = global_filters.contains(&n.reason);
    let is_repo_filtered = repo_filters
      .get(&n.repository.full_name)
      .is_some_and(|reasons| reasons.contains(&n.reason));

    // FIXME: Current implementation skips filtered notifications entirely (continue
    // before INSERT). Because GitHub API sync uses `since=last_synced_at`, a
    // notification filtered once may never be re-fetched unless it gets new activity.
    // This means removing a filter won't reliably resurface previously filtered
    // notifications. To make filtering non-destructive, we should:
    // 1. Add `is_filtered BOOLEAN DEFAULT 0` column to notifications table
    // 2. INSERT all notifications and set is_filtered=1 for matched filters
    // 3. Update all SELECT queries to filter out `WHERE is_filtered = 0` by default
    // 4. Add UI to view/unfilter hidden notifications
    // This requires schema migration + changes across multiple files.
    if is_globally_filtered || is_repo_filtered {
      continue;
    }

    let html_url = n
      .subject
      .url
      .as_deref()
      .and_then(github::api_url_to_html_url);

    // Check thread_mappings to auto-assign project_id for this notification.
    let thread_project_id: Option<i64> = db
      .query_row(
        "SELECT project_id FROM thread_mappings \
         WHERE repo_full_name = ?1 AND thread_id = ?2",
        params![n.repository.full_name, n.id],
        |row| row.get(0),
      )
      .optional()
      .map_err(|e| e.to_string())?;

    // Fall back to a repo-level rule when there is no thread-level mapping.
    let mapped_project_id: Option<i64> = if thread_project_id.is_some() {
      thread_project_id
    } else {
      db.query_row(
        "SELECT project_id FROM repo_rules WHERE repo_full_name = ?1",
        params![n.repository.full_name],
        |row| row.get(0),
      )
      .optional()
      .map_err(|e| e.to_string())?
    };

    // Determine terminal state.  Skip the API fetch if the notification is
    // already persisted as terminal — once terminal, always terminal.
    let already_terminal: bool = db
      .query_row(
        "SELECT is_terminal FROM notifications WHERE github_id = ?1",
        params![n.id],
        |row| row.get(0),
      )
      .optional()
      .map_err(|e| e.to_string())?
      .unwrap_or(false);

    let is_terminal = already_terminal
      || n
        .subject
        .url
        .as_deref()
        .is_some_and(|url| github::fetch_is_terminal(&client, url, &n.subject.subject_type));

    // Terminal notifications are auto-marked read so they don't create noise.
    let is_read = is_terminal || !n.unread;

    db.execute(
      "INSERT INTO notifications \
         (github_id, repo_full_name, subject_title, subject_type, subject_url, \
          reason, is_read, updated_at, html_url, project_id, is_terminal) \
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) \
       ON CONFLICT(github_id) DO UPDATE SET \
         repo_full_name = excluded.repo_full_name, \
         subject_title  = excluded.subject_title, \
         subject_type   = excluded.subject_type, \
         subject_url    = excluded.subject_url, \
         reason         = excluded.reason, \
         is_read        = CASE WHEN excluded.is_terminal = 1 THEN 1 \
                               WHEN excluded.is_read = 0 THEN 0 \
                               ELSE notifications.is_read END, \
         updated_at     = excluded.updated_at, \
         html_url       = excluded.html_url, \
         project_id     = COALESCE(notifications.project_id, excluded.project_id), \
         is_terminal    = MAX(notifications.is_terminal, excluded.is_terminal), \
         comment_body   = CASE WHEN excluded.updated_at != notifications.updated_at \
                               THEN NULL ELSE notifications.comment_body END, \
         comment_author = CASE WHEN excluded.updated_at != notifications.updated_at \
                               THEN NULL ELSE notifications.comment_author END, \
         comment_avatar = CASE WHEN excluded.updated_at != notifications.updated_at \
                               THEN NULL ELSE notifications.comment_avatar END, \
         comment_at     = CASE WHEN excluded.updated_at != notifications.updated_at \
                               THEN NULL ELSE notifications.comment_at END",
      params![
        n.id,
        n.repository.full_name,
        n.subject.title,
        n.subject.subject_type,
        n.subject.url,
        n.reason,
        is_read,
        n.updated_at,
        html_url,
        mapped_project_id,
        is_terminal,
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

  // Re-examine any unread non-terminal PR/Issue notifications that may have
  // become terminal since we last synced.  GitHub's `since` filter means we
  // won't receive those notifications again once their `updated_at` is older
  // than `last_synced_at`, so this pass catches any that slipped through (e.g.
  // because `fetch_is_terminal` hit a rate-limit or timeout on a prior sync).
  //
  // To avoid hammering the GitHub API on every sync (which may run as often as
  // once per minute), gate this recheck so it runs at most once every 5 minutes.
  let should_recheck: bool = db
    .query_row(
      "SELECT CASE \
         WHEN EXISTS ( \
           SELECT 1 FROM settings \
           WHERE key = 'last_nonterminal_recheck_at' \
             AND datetime(value) > datetime('now', '-5 minutes') \
         ) THEN 0 \
         ELSE 1 \
       END",
      [],
      |row| {
        let v: i64 = row.get(0)?;
        Ok(v == 1)
      },
    )
    .map_err(|e| e.to_string())?;

  if should_recheck {
    recheck_stale_nonterminal(db, &client)?;
    db.execute(
      "INSERT OR REPLACE INTO settings (key, value) \
         VALUES ('last_nonterminal_recheck_at', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))",
      [],
    )
    .map_err(|e| e.to_string())?;
  }

  // Record when the last successful sync completed (ISO 8601, UTC).
  db.execute(
    "INSERT OR REPLACE INTO settings (key, value) \
     VALUES ('last_synced_at', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))",
    [],
  )
  .map_err(|e| e.to_string())?;

  Ok(())
}

/// Re-examine every unread, non-terminal PR/Issue notification already in the DB.
///
/// GitHub only resurfaces a notification when its `updated_at` changes since
/// `last_synced_at`.  If `fetch_is_terminal` silently failed on a previous sync
/// (rate-limit, transient network error, etc.) the notification stays stuck as
/// non-terminal even though the underlying PR has since been merged or closed.
/// This function catches that case by directly re-querying the GitHub subject URL
/// for every notification that is still visible in Active Threads.
fn recheck_stale_nonterminal(
  db: &rusqlite::Connection,
  client: &reqwest::blocking::Client,
) -> Result<(), String> {
  struct Pending {
    id: i64,
    subject_url: String,
    subject_type: String,
  }

  // Only recheck notifications that are older than `last_synced_at`.  Those
  // are the ones GitHub silently excluded from the current sync batch; they
  // were already checked in the main loop if they appeared in this batch.
  let last_synced_at: Option<String> = db
    .query_row(
      "SELECT value FROM settings WHERE key = 'last_synced_at'",
      [],
      |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  let mut stmt = db
    .prepare(
      "SELECT id, subject_url, subject_type FROM notifications \
       WHERE is_terminal = 0 AND (is_read = 0 OR action_needed = 1) \
         AND subject_type IN ('PullRequest', 'Issue') \
         AND subject_url IS NOT NULL \
         AND (?1 IS NULL OR datetime(updated_at) < datetime(?1))",
    )
    .map_err(|e| e.to_string())?;

  let pending: Vec<Pending> = stmt
    .query_map(params![last_synced_at], |row| {
      Ok(Pending {
        id: row.get(0)?,
        subject_url: row.get(1)?,
        subject_type: row.get(2)?,
      })
    })
    .and_then(|rows| rows.collect())
    .map_err(|e| e.to_string())?;

  for p in pending {
    if github::fetch_is_terminal(client, &p.subject_url, &p.subject_type) {
      db.execute(
        "UPDATE notifications SET is_terminal = 1, is_read = 1 WHERE id = ?1",
        params![p.id],
      )
      .map_err(|e| e.to_string())?;
    }
  }

  Ok(())
}

/// Entry point for the background polling task. Gets the token from the in-memory
/// cache — never touches the Keychain.
pub(crate) fn background_sync(
  db_state: &crate::db::DbState,
  token_cache: &crate::db::TokenCache,
) -> Result<(), String> {
  let token = get_cached_token(token_cache)?;
  // Read last_synced_at before releasing the lock so the fetch has no DB contention.
  let since = {
    let db = db_state.0.lock().map_err(|e| e.to_string())?;
    db.query_row(
      "SELECT value FROM settings WHERE key = 'last_synced_at'",
      [],
      |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| e.to_string())?
  };
  let api_notifications = github::fetch_notifications(&token, since.as_deref())?; // no DB lock held
  let db = db_state.0.lock().map_err(|e| e.to_string())?;
  process_notifications(&db, &api_notifications, &token)
}

#[tauri::command]
pub async fn sync_notifications(app_handle: tauri::AppHandle) -> Result<(), String> {
  // Fail fast before spawning if there is no token configured.
  {
    let token_cache = app_handle.state::<TokenCache>();
    get_cached_token(&token_cache)?;
  }

  // Check if a sync is already in progress and prevent concurrent syncs.
  let sync_state = app_handle.state::<SyncState>();
  if sync_state
    .0
    .compare_exchange(
      false,
      true,
      std::sync::atomic::Ordering::SeqCst,
      std::sync::atomic::Ordering::SeqCst,
    )
    .is_err()
  {
    return Err("Sync already in progress".to_string());
  }

  // Spawn the blocking network + DB work on a thread-pool thread so the
  // IPC call returns immediately and the UI never freezes.
  tauri::async_runtime::spawn(async move {
    let result = tokio::task::spawn_blocking({
      let handle = app_handle.clone();
      move || {
        let db_state = handle.state::<DbState>();
        let token_cache = handle.state::<TokenCache>();
        background_sync(&db_state, &token_cache)
      }
    })
    .await;

    // Clear the sync-in-progress flag before emitting the event.
    let sync_state = app_handle.state::<SyncState>();
    sync_state
      .0
      .store(false, std::sync::atomic::Ordering::SeqCst);

    match result {
      Ok(Ok(())) => {
        let _ = app_handle.emit("sync-complete", serde_json::json!({ "ok": true }));
        // Kick off comment prefetch now that fresh notifications are in the DB.
        let handle2 = app_handle.clone();
        if let Err(e) = tokio::task::spawn_blocking(move || {
          let db_state = handle2.state::<DbState>();
          let token_cache = handle2.state::<TokenCache>();
          do_prefetch_comments(&handle2, &db_state, &token_cache);
        })
        .await
        {
          eprintln!("[sync] prefetch panicked: {e}");
        }
      }
      Ok(Err(e)) => {
        let _ = app_handle.emit(
          "sync-complete",
          serde_json::json!({ "ok": false, "error": e }),
        );
      }
      Err(e) => {
        let _ = app_handle.emit(
          "sync-complete",
          serde_json::json!({ "ok": false, "error": e.to_string() }),
        );
      }
    }
  });

  Ok(())
}

// ---------------------------------------------------------------------------
// Comment prefetch
// ---------------------------------------------------------------------------

/// Fetch the latest comment for every unread, non-terminal Issue/PR notification
/// that doesn't already have prefetched comment data.  Runs synchronously on the
/// calling thread — callers should always invoke this from a `spawn_blocking`
/// context.  Results are written to the DB and each resolved notification is
/// emitted as a `notification-comment-ready` event so the UI can update in place.
pub fn do_prefetch_comments(
  handle: &tauri::AppHandle,
  db_state: &DbState,
  token_cache: &TokenCache,
) {
  let token: String = {
    let Ok(guard) = token_cache.0.lock() else {
      return;
    };
    match (*guard).clone() {
      Some(t) => t,
      None => return,
    }
  };

  // Collect the minimal set of fields needed to drive the fetch.
  // We fully collect here (before releasing the lock) so no borrow escapes.
  let to_fetch: Vec<(i64, String, String)> = {
    let Ok(db) = db_state.0.lock() else {
      return;
    };
    let Ok(mut stmt) = db.prepare(
      "SELECT id, subject_url, subject_type FROM notifications \
       WHERE is_read = 0 AND is_terminal = 0 AND comment_body IS NULL \
         AND subject_url IS NOT NULL \
         AND subject_type IN ('Issue', 'PullRequest')",
    ) else {
      return;
    };
    stmt
      .query_map([], |row: &rusqlite::Row<'_>| {
        Ok((
          row.get::<_, i64>(0)?,
          row.get::<_, String>(1)?,
          row.get::<_, String>(2)?,
        ))
      })
      .map(|rows| {
        rows
          .collect::<rusqlite::Result<Vec<_>>>()
          .unwrap_or_default()
      })
      .unwrap_or_default()
  };

  if to_fetch.is_empty() {
    return;
  }

  let Ok(client) = github::make_client_public(&token) else {
    return;
  };

  for (id, subject_url, subject_type) in &to_fetch {
    let Some(comment) = github::fetch_latest_comment(&client, subject_url, subject_type) else {
      continue;
    };

    // Persist the comment.
    if let Ok(db) = db_state.0.lock() {
      let _ = db.execute(
        "UPDATE notifications \
         SET comment_body = ?1, comment_author = ?2, comment_avatar = ?3, comment_at = ?4 \
         WHERE id = ?5",
        params![
          comment.body,
          comment.author,
          comment.avatar,
          comment.created_at,
          id
        ],
      );
    }

    // Read back the full notification and emit an update event.
    let updated: Option<GithubNotification> = db_state.0.lock().ok().and_then(|db| {
      db.query_row(
        &format!("{NOTIFICATION_COLS} WHERE id = ?1"),
        params![id],
        notification_from_row,
      )
      .ok()
    });

    if let Some(notif) = updated {
      let _ = handle.emit("notification-comment-ready", &notif);
    }
  }
}

/// Kick off comment prefetching for all eligible notifications in the background.
/// Returns immediately — the actual fetches run on a `spawn_blocking` thread and
/// emit `notification-comment-ready` events as each one resolves.
#[tauri::command]
pub async fn prefetch_notification_comments(app_handle: tauri::AppHandle) -> Result<(), String> {
  tauri::async_runtime::spawn(async move {
    if let Err(e) = tokio::task::spawn_blocking(move || {
      let db_state = app_handle.state::<DbState>();
      let token_cache = app_handle.state::<TokenCache>();
      do_prefetch_comments(&app_handle, &db_state, &token_cache);
    })
    .await
    {
      eprintln!("[prefetch] task panicked: {e}");
    }
  });
  Ok(())
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
// Bookmark commands
// ---------------------------------------------------------------------------

fn bookmark_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Bookmark> {
  Ok(Bookmark {
    id: row.get(0)?,
    project_id: row.get(1)?,
    name: row.get(2)?,
    url: row.get(3)?,
  })
}

#[tauri::command]
pub fn get_bookmarks(
  project_id: i64,
  state: tauri::State<'_, DbState>,
) -> Result<Vec<Bookmark>, String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  let mut stmt = db
    .prepare(
      "SELECT id, project_id, name, url FROM bookmarks \
       WHERE project_id = ?1 ORDER BY created_at ASC",
    )
    .map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map(params![project_id], bookmark_from_row)
    .map_err(|e| e.to_string())?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(|e| e.to_string())?;
  Ok(rows)
}

#[tauri::command]
pub fn create_bookmark(
  project_id: i64,
  name: String,
  url: String,
  state: tauri::State<'_, DbState>,
) -> Result<Bookmark, String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute(
    "INSERT INTO bookmarks (project_id, name, url) VALUES (?1, ?2, ?3)",
    params![project_id, name, url],
  )
  .map_err(|e| e.to_string())?;
  let id = db.last_insert_rowid();
  db.query_row(
    "SELECT id, project_id, name, url FROM bookmarks WHERE id = ?1",
    params![id],
    bookmark_from_row,
  )
  .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_bookmark(id: i64, state: tauri::State<'_, DbState>) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])
    .map_err(|e| e.to_string())?;
  Ok(())
}

// ---------------------------------------------------------------------------
// Global filter commands
// ---------------------------------------------------------------------------

fn global_filter_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GlobalFilter> {
  Ok(GlobalFilter {
    id: row.get(0)?,
    reason: row.get(1)?,
    created_at: row.get(2)?,
  })
}

#[tauri::command]
pub fn get_global_filters(state: tauri::State<'_, DbState>) -> Result<Vec<GlobalFilter>, String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  let mut stmt = db
    .prepare("SELECT id, reason, created_at FROM global_filters ORDER BY reason ASC")
    .map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map([], global_filter_from_row)
    .map_err(|e| e.to_string())?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(|e| e.to_string())?;
  Ok(rows)
}

#[tauri::command]
pub fn create_global_filter(
  reason: String,
  state: tauri::State<'_, DbState>,
) -> Result<GlobalFilter, String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute(
    "INSERT INTO global_filters (reason) VALUES (?1)",
    params![reason],
  )
  .map_err(|e| e.to_string())?;
  let id = db.last_insert_rowid();
  db.query_row(
    "SELECT id, reason, created_at FROM global_filters WHERE id = ?1",
    params![id],
    global_filter_from_row,
  )
  .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_global_filter(id: i64, state: tauri::State<'_, DbState>) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute("DELETE FROM global_filters WHERE id = ?1", params![id])
    .map_err(|e| e.to_string())?;
  Ok(())
}

// ---------------------------------------------------------------------------
// Repo filter commands
// ---------------------------------------------------------------------------

fn repo_filter_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RepoFilter> {
  Ok(RepoFilter {
    id: row.get(0)?,
    repo_full_name: row.get(1)?,
    reason: row.get(2)?,
    created_at: row.get(3)?,
  })
}

#[tauri::command]
pub fn get_repo_filters(state: tauri::State<'_, DbState>) -> Result<Vec<RepoFilter>, String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  let mut stmt = db
    .prepare(
      "SELECT id, repo_full_name, reason, created_at FROM repo_filters \
       ORDER BY repo_full_name ASC, reason ASC",
    )
    .map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map([], repo_filter_from_row)
    .map_err(|e| e.to_string())?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(|e| e.to_string())?;
  Ok(rows)
}

#[tauri::command]
pub fn create_repo_filter(
  repo_full_name: String,
  reason: String,
  state: tauri::State<'_, DbState>,
) -> Result<RepoFilter, String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute(
    "INSERT INTO repo_filters (repo_full_name, reason) VALUES (?1, ?2)",
    params![repo_full_name, reason],
  )
  .map_err(|e| e.to_string())?;
  let id = db.last_insert_rowid();
  db.query_row(
    "SELECT id, repo_full_name, reason, created_at FROM repo_filters WHERE id = ?1",
    params![id],
    repo_filter_from_row,
  )
  .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_repo_filter(id: i64, state: tauri::State<'_, DbState>) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute("DELETE FROM repo_filters WHERE id = ?1", params![id])
    .map_err(|e| e.to_string())?;
  Ok(())
}

// ---------------------------------------------------------------------------
// Repo rule commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_repo_rules(state: tauri::State<'_, DbState>) -> Result<Vec<RepoRule>, String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  let mut stmt = db
    .prepare(
      "SELECT r.id, r.repo_full_name, r.project_id, p.name, r.created_at \
       FROM repo_rules r \
       JOIN projects p ON p.id = r.project_id \
       ORDER BY r.repo_full_name",
    )
    .map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map([], |row| {
      Ok(RepoRule {
        id: row.get(0)?,
        repo_full_name: row.get(1)?,
        project_id: row.get(2)?,
        project_name: row.get(3)?,
        created_at: row.get(4)?,
      })
    })
    .map_err(|e| e.to_string())?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(|e| e.to_string())?;
  Ok(rows)
}

#[tauri::command]
pub fn update_repo_rule(
  id: i64,
  project_id: i64,
  state: tauri::State<'_, DbState>,
) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute(
    "UPDATE repo_rules SET project_id = ?1 WHERE id = ?2",
    params![project_id, id],
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn delete_repo_rule(id: i64, state: tauri::State<'_, DbState>) -> Result<(), String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute("DELETE FROM repo_rules WHERE id = ?1", params![id])
    .map_err(|e| e.to_string())?;
  Ok(())
}

// ---------------------------------------------------------------------------
// GitHub Copilot AI assistant command
// ---------------------------------------------------------------------------

/// Structs for the Copilot chat completions request / response.
#[derive(serde::Serialize)]
struct ChatMessage {
  role: String,
  content: String,
}

#[derive(serde::Serialize)]
struct ChatRequest {
  model: String,
  messages: Vec<ChatMessage>,
  stream: bool,
}

#[derive(serde::Deserialize)]
struct ChatChoice {
  message: ChatChoiceMessage,
}

#[derive(serde::Deserialize)]
struct ChatChoiceMessage {
  content: String,
}

#[derive(serde::Deserialize)]
struct ChatResponse {
  choices: Vec<ChatChoice>,
}

/// Build a human-readable summary of notifications for the LLM prompt.
fn format_notifications_for_prompt(notifications: &[crate::models::GithubNotification]) -> String {
  use std::fmt::Write as _;
  if notifications.is_empty() {
    return "No active notifications found.".into();
  }
  notifications
    .iter()
    .enumerate()
    .map(|(i, n)| {
      let mut line = format!(
        "{}. [{}] {} — {} ({})",
        i + 1,
        n.subject_type,
        n.subject_title,
        n.repo_full_name,
        n.reason,
      );
      if let Some(url) = &n.html_url {
        let _ = write!(line, " <{url}>");
      }
      if n.action_needed {
        line.push_str(" [ACTION NEEDED]");
      }
      if let Some(body) = &n.comment_body {
        let preview: String = body.chars().take(120).collect();
        let _ = write!(line, "\n   Latest comment: {preview}");
      }
      line
    })
    .collect::<Vec<_>>()
    .join("\n")
}

/// Build the system + user prompt for the requested query type.
fn build_messages(query_type: &str, notification_text: &str) -> Result<Vec<ChatMessage>, String> {
  let system = ChatMessage {
    role: "system".into(),
    content: "You are a GitHub notification assistant. \
      Reply with ONLY a markdown checklist — no preamble, no explanation, no trailing text. \
      Each item must start with `- [ ] `. \
      If a GitHub URL is available for the item, append it in parentheses e.g. \
      `- [ ] Review PR #42 (https://github.com/org/repo/pull/42)`. \
      Limit your response to 5 items maximum."
      .into(),
  };
  let user_content = match query_type {
    "waiting_on_me" => format!(
      "From the notifications below, identify threads where someone is \
       explicitly waiting on me to respond or take action.\n\n{notification_text}"
    ),
    "quick_wins" => format!(
      "From the notifications below, identify 3–5 short, low-effort items \
       I can close out quickly (quick wins).\n\n{notification_text}"
    ),
    _ => {
      return Err(format!(
        "Invalid query_type: '{query_type}'. Expected 'waiting_on_me' or 'quick_wins'."
      ))
    }
  };
  Ok(vec![
    system,
    ChatMessage {
      role: "user".into(),
      content: user_content,
    },
  ])
}

#[tauri::command]
pub fn query_copilot(
  query_type: String,
  copilot_cache: tauri::State<'_, CopilotTokenCache>,
  token_cache: tauri::State<'_, TokenCache>,
  state: tauri::State<'_, DbState>,
) -> Result<String, String> {
  // Prefer the dedicated Copilot Fine-Grained PAT; fall back to the
  // notifications Classic PAT — GitHub Models accepts both.
  let token: String = {
    let copilot = copilot_cache.0.lock().map_err(|e| e.to_string())?.clone();
    if let Some(t) = copilot {
      t
    } else {
      token_cache
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("No GitHub token configured. Please complete setup first.")?
    }
  };

  // Fetch active notifications (unread OR action_needed, non-terminal).
  let notifications: Vec<crate::models::GithubNotification> = {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let sql = format!(
      "{NOTIFICATION_COLS} \
       WHERE is_terminal = 0 AND (is_read = 0 OR action_needed = 1) \
       ORDER BY updated_at DESC LIMIT 50"
    );
    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let result = stmt
      .query_map([], notification_from_row)
      .map_err(|e| e.to_string())?
      .collect::<rusqlite::Result<Vec<_>>>()
      .map_err(|e| e.to_string())?;
    result
  };

  let notification_text = format_notifications_for_prompt(&notifications);

  // Call the Copilot chat completions endpoint directly with the Fine-Grained PAT.
  let client = reqwest::blocking::Client::builder()
    .build()
    .map_err(|e| e.to_string())?;

  let messages = build_messages(&query_type, &notification_text)?;
  let request_body = ChatRequest {
    model: "openai/gpt-5-mini".into(),
    messages,
    stream: false,
  };

  let resp = client
    .post("https://models.github.ai/inference/chat/completions")
    .header("Authorization", format!("Bearer {token}"))
    .header("Content-Type", "application/json")
    .header("User-Agent", "gh-notifier/0.1")
    .json(&request_body)
    .send()
    .map_err(|e| format!("Failed to reach GitHub Copilot API: {e}"))?;

  if !resp.status().is_success() {
    let status = resp.status().as_u16();
    let body = resp.text().unwrap_or_default();
    let truncated_body: String = body.chars().take(200).collect();
    let suffix = if body.len() > 200 { "..." } else { "" };
    return Err(format!(
      "GitHub Models API returned HTTP {status}: {truncated_body}{suffix}"
    ));
  }

  let chat: ChatResponse = resp
    .json()
    .map_err(|e| format!("Invalid Copilot API response: {e}"))?;

  chat
    .choices
    .into_iter()
    .next()
    .map(|c| c.message.content)
    .ok_or_else(|| "Copilot returned no choices".into())
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
        CREATE TABLE manual_tasks (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          title      TEXT    NOT NULL,
          is_done    INTEGER NOT NULL DEFAULT 0,
          project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE bookmarks (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name       TEXT    NOT NULL,
          url        TEXT    NOT NULL,
          created_at TEXT    NOT NULL DEFAULT (datetime('now'))
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
  // Manual task deletion unit test
  // ---------------------------------------------------------------------------

  #[test]
  fn delete_manual_task_removes_task_and_leaves_others() {
    let db = test_db();
    let pid = insert_project(&db, "Task Project");

    // Create three manual tasks
    db.execute(
      "INSERT INTO manual_tasks (title, project_id) VALUES (?1, ?2)",
      params!["Task 1", pid],
    )
    .unwrap();
    let task1_id = db.last_insert_rowid();

    db.execute(
      "INSERT INTO manual_tasks (title, project_id) VALUES (?1, ?2)",
      params!["Task 2", pid],
    )
    .unwrap();
    let task2_id = db.last_insert_rowid();

    db.execute(
      "INSERT INTO manual_tasks (title, project_id) VALUES (?1, ?2)",
      params!["Task 3", pid],
    )
    .unwrap();
    let task3_id = db.last_insert_rowid();

    // Verify all three exist
    let count: i64 = db
      .query_row("SELECT COUNT(*) FROM manual_tasks", [], |row| row.get(0))
      .unwrap();
    assert_eq!(count, 3);

    // Delete task 2 (using the same SQL as delete_manual_task)
    db.execute("DELETE FROM manual_tasks WHERE id = ?1", params![task2_id])
      .unwrap();

    // Verify only 2 remain
    let count: i64 = db
      .query_row("SELECT COUNT(*) FROM manual_tasks", [], |row| row.get(0))
      .unwrap();
    assert_eq!(count, 2);

    // Verify task 2 is gone
    let exists: bool = db
      .query_row(
        "SELECT EXISTS(SELECT 1 FROM manual_tasks WHERE id = ?1)",
        params![task2_id],
        |row| row.get(0),
      )
      .unwrap();
    assert!(!exists);

    // Verify task 1 and 3 still exist
    let task1_exists: bool = db
      .query_row(
        "SELECT EXISTS(SELECT 1 FROM manual_tasks WHERE id = ?1)",
        params![task1_id],
        |row| row.get(0),
      )
      .unwrap();
    assert!(task1_exists);

    let task3_exists: bool = db
      .query_row(
        "SELECT EXISTS(SELECT 1 FROM manual_tasks WHERE id = ?1)",
        params![task3_id],
        |row| row.get(0),
      )
      .unwrap();
    assert!(task3_exists);
  }

  // ---------------------------------------------------------------------------
  // Bookmark CRUD unit tests
  // ---------------------------------------------------------------------------

  #[test]
  fn create_bookmark_inserts_and_returns_bookmark() {
    let db = test_db();
    let pid = insert_project(&db, "Bookmark Project");

    db.execute(
      "INSERT INTO bookmarks (project_id, name, url) VALUES (?1, ?2, ?3)",
      params![pid, "GitHub", "https://github.com"],
    )
    .unwrap();
    let bookmark_id = db.last_insert_rowid();

    let (name, url): (String, String) = db
      .query_row(
        "SELECT name, url FROM bookmarks WHERE id = ?1",
        params![bookmark_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
      )
      .unwrap();

    assert_eq!(name, "GitHub");
    assert_eq!(url, "https://github.com");
  }

  #[test]
  fn get_bookmarks_returns_ordered_by_created_at() {
    let db = test_db();
    let pid = insert_project(&db, "Multi Bookmark Project");

    db.execute(
      "INSERT INTO bookmarks (project_id, name, url, created_at) \
       VALUES (?1, 'First', 'https://first.com', '2024-01-01T00:00:00Z')",
      params![pid],
    )
    .unwrap();

    db.execute(
      "INSERT INTO bookmarks (project_id, name, url, created_at) \
       VALUES (?1, 'Second', 'https://second.com', '2024-01-02T00:00:00Z')",
      params![pid],
    )
    .unwrap();

    db.execute(
      "INSERT INTO bookmarks (project_id, name, url, created_at) \
       VALUES (?1, 'Third', 'https://third.com', '2024-01-03T00:00:00Z')",
      params![pid],
    )
    .unwrap();

    let bookmarks: Vec<String> = db
      .prepare("SELECT name FROM bookmarks WHERE project_id = ?1 ORDER BY created_at ASC")
      .unwrap()
      .query_map(params![pid], |row| row.get(0))
      .unwrap()
      .collect::<rusqlite::Result<Vec<_>>>()
      .unwrap();

    assert_eq!(bookmarks, vec!["First", "Second", "Third"]);
  }

  #[test]
  fn delete_bookmark_removes_bookmark() {
    let db = test_db();
    let pid = insert_project(&db, "Delete Bookmark Project");

    db.execute(
      "INSERT INTO bookmarks (project_id, name, url) VALUES (?1, ?2, ?3)",
      params![pid, "To Delete", "https://example.com"],
    )
    .unwrap();
    let bookmark_id = db.last_insert_rowid();

    db.execute(
      "INSERT INTO bookmarks (project_id, name, url) VALUES (?1, ?2, ?3)",
      params![pid, "To Keep", "https://keeper.com"],
    )
    .unwrap();

    db.execute("DELETE FROM bookmarks WHERE id = ?1", params![bookmark_id])
      .unwrap();

    let exists: bool = db
      .query_row(
        "SELECT EXISTS(SELECT 1 FROM bookmarks WHERE id = ?1)",
        params![bookmark_id],
        |row| row.get(0),
      )
      .unwrap();
    assert!(!exists);

    let remaining: i64 = db
      .query_row(
        "SELECT COUNT(*) FROM bookmarks WHERE project_id = ?1",
        params![pid],
        |row| row.get(0),
      )
      .unwrap();
    assert_eq!(remaining, 1);
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
