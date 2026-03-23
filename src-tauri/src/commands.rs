#![allow(clippy::needless_pass_by_value)]
#![allow(clippy::missing_errors_doc)]

use crate::{
  db::DbState,
  github,
  models::{AppSettings, GithubNotification, ManualTask, Project},
};
use keyring::Entry;
use rusqlite::{params, OptionalExtension};

const KEYRING_SERVICE: &str = "gh-notifier";
const KEYRING_USER: &str = "github_token";

fn keychain_entry() -> Result<Entry, String> {
  Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
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
  let sql = format!("{NOTIFICATION_COLS} WHERE project_id IS NULL ORDER BY updated_at DESC");
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
  db.execute(
    "UPDATE notifications SET project_id = ?1 WHERE id = ?2",
    params![project_id, notification_id],
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
pub fn unsubscribe_thread(id: i64, state: tauri::State<'_, DbState>) -> Result<(), String> {
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
  match keychain_entry()?.get_password() {
    Ok(token) => github::unsubscribe_thread(&token, &github_id)?,
    Err(keyring::Error::NoEntry) => {} // no token yet — skip API call
    Err(e) => return Err(format!("Keychain error: {e}")),
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
pub fn get_settings(state: tauri::State<'_, DbState>) -> Result<AppSettings, String> {
  let db = state.0.lock().map_err(|e| e.to_string())?;

  // PAT lives in the macOS Keychain — never in SQLite
  let github_token = match keychain_entry()?.get_password() {
    Ok(token) => Some(token),
    Err(keyring::Error::NoEntry) => None,
    Err(e) => return Err(format!("Keychain error: {e}")),
  };

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

  Ok(AppSettings {
    github_token,
    poll_interval_minutes,
    is_setup_complete,
  })
}

#[tauri::command]
pub fn save_github_token(token: String, state: tauri::State<'_, DbState>) -> Result<(), String> {
  // Validate before storing — fail fast with a useful error message.
  github::validate_token(&token)?;

  // Store the PAT in the macOS Keychain (encrypted at rest).
  keychain_entry()?
    .set_password(&token)
    .map_err(|e| e.to_string())?;

  let db = state.0.lock().map_err(|e| e.to_string())?;
  db.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('is_setup_complete', 'true')",
    [],
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn sync_notifications(state: tauri::State<'_, DbState>) -> Result<(), String> {
  let token = match keychain_entry()?.get_password() {
    Ok(t) => t,
    Err(keyring::Error::NoEntry) => {
      return Err("No GitHub token configured. Please complete setup first.".into())
    }
    Err(e) => return Err(format!("Keychain error: {e}")),
  };

  let api_notifications = github::fetch_notifications(&token)?;

  let db = state.0.lock().map_err(|e| e.to_string())?;

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

    db.execute(
      "INSERT INTO notifications \
         (github_id, repo_full_name, subject_title, subject_type, subject_url, \
          reason, is_read, updated_at, html_url) \
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
       ON CONFLICT(github_id) DO UPDATE SET \
         subject_title = excluded.subject_title, \
         reason        = excluded.reason, \
         is_read       = CASE WHEN excluded.is_read = 0 THEN 0 ELSE notifications.is_read END, \
         updated_at    = excluded.updated_at, \
         html_url      = excluded.html_url",
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
      ],
    )
    .map_err(|e| e.to_string())?;
  }

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
