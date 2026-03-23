mod commands;
mod db;
mod github;
mod models;

use commands::{
  assign_notification_to_project, create_manual_task, create_project, delete_project,
  get_manual_tasks, get_notifications, get_project, get_projects, get_settings,
  get_unmapped_notifications, mark_notification_read, save_github_token, save_settings,
  snooze_project, sync_notifications, toggle_manual_task, unsubscribe_thread, update_project,
  wake_project,
};
use std::time::Duration;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::missing_panics_doc)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      let app_data_dir = app.path().app_data_dir()?;
      let conn = db::init_db(&app_data_dir).map_err(std::io::Error::other)?;
      // Wake any date-based snoozed projects whose snooze_until has passed.
      conn
        .execute(
          "UPDATE projects \
           SET status = 'active', snooze_mode = NULL, snooze_until = NULL, \
               updated_at = datetime('now') \
           WHERE status = 'snoozed' AND snooze_mode = 'date' \
             AND snooze_until IS NOT NULL AND datetime(snooze_until) <= datetime('now')",
          [],
        )
        .map_err(std::io::Error::other)?;
      app.manage(db::DbState(std::sync::Mutex::new(conn)));

      // Spawn the background notification polling loop.
      let handle = app.handle().clone();
      tauri::async_runtime::spawn(poll_loop(handle));

      Ok(())
    })
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![
      get_projects,
      get_project,
      create_project,
      update_project,
      delete_project,
      snooze_project,
      wake_project,
      get_notifications,
      get_unmapped_notifications,
      assign_notification_to_project,
      mark_notification_read,
      unsubscribe_thread,
      get_settings,
      save_github_token,
      save_settings,
      sync_notifications,
      get_manual_tasks,
      create_manual_task,
      toggle_manual_task,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

/// Background task: sleep for the configured interval, run a full sync, repeat.
/// Errors are logged and swallowed so the loop never crashes the app.
async fn poll_loop(handle: tauri::AppHandle) {
  loop {
    // Read the current poll interval from the DB before sleeping so that
    // changes made in Settings take effect on the very next cycle.
    let interval_mins: i64 = {
      if let Ok(db) = handle.state::<db::DbState>().0.lock() {
        db.query_row(
          "SELECT value FROM settings WHERE key = 'poll_interval_minutes'",
          [],
          |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(5)
      } else {
        5
      }
    }; // MutexGuard dropped here — never held across an await

    let secs = u64::try_from(interval_mins.max(1)).unwrap_or(5) * 60;
    tokio::time::sleep(Duration::from_secs(secs)).await;

    // Run the blocking sync work on a thread-pool thread so we don't stall
    // the async executor.
    let handle2 = handle.clone();
    let result = tokio::task::spawn_blocking(move || {
      let state = handle2.state::<db::DbState>();
      commands::background_sync(&state)
    })
    .await;

    match result {
      Ok(Ok(())) => {}
      Ok(Err(e)) => eprintln!("[poll] sync error: {e}"),
      Err(e) => eprintln!("[poll] task panicked: {e}"),
    }
  }
}
