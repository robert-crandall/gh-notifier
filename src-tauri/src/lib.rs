mod commands;
mod db;
mod github;
mod models;

use commands::{
  assign_notification_to_project, create_bookmark, create_global_filter, create_manual_task,
  create_project, create_repo_filter, create_repo_rule, delete_bookmark, delete_global_filter,
  delete_manual_task, delete_project, delete_repo_filter, delete_repo_rule, get_bookmarks,
  get_global_filters, get_manual_tasks, get_notifications, get_project, get_projects,
  get_repo_filters, get_repo_rules, get_settings, get_unmapped_notifications,
  mark_notification_read, mark_notification_unread, prefetch_notification_comments,
  save_github_token, save_settings, snooze_project, sync_notifications, toggle_manual_task,
  unsubscribe_thread, update_project, update_repo_rule, wake_project,
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

      // Load (or generate on first launch) the AES-256-GCM key, then decrypt
      // the PAT from SQLite into the in-memory cache — no user prompt needed.
      let enc_key = db::load_or_create_key(&app_data_dir).map_err(std::io::Error::other)?;
      let cached_token = commands::load_token_for_cache(&conn, &enc_key);
      app.manage(db::DbState(std::sync::Mutex::new(conn)));
      app.manage(db::EncKey(enc_key));
      app.manage(db::TokenCache(std::sync::Mutex::new(cached_token)));

      // Spawn the background notification polling loop.
      let handle = app.handle().clone();
      tauri::async_runtime::spawn(poll_loop(handle));

      Ok(())
    })
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_window_state::Builder::default().build())
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
      mark_notification_unread,
      unsubscribe_thread,
      get_settings,
      save_github_token,
      save_settings,
      sync_notifications,
      get_manual_tasks,
      create_manual_task,
      toggle_manual_task,
      delete_manual_task,
      create_repo_rule,
      get_repo_rules,
      update_repo_rule,
      delete_repo_rule,
      get_bookmarks,
      create_bookmark,
      delete_bookmark,
      prefetch_notification_comments,
      get_global_filters,
      create_global_filter,
      delete_global_filter,
      get_repo_filters,
      create_repo_filter,
      delete_repo_filter,
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
      let db_state = handle2.state::<db::DbState>();
      let token_cache = handle2.state::<db::TokenCache>();
      commands::background_sync(&db_state, &token_cache)
    })
    .await;

    match result {
      Ok(Ok(())) => {
        // After a successful sync, prefetch latest comments for unread threads
        // that don't have cached content yet. Fire-and-forget — failures in
        // do_prefetch_comments don't surface to the user, and only panics in this
        // background task are logged here.
        let handle3 = handle.clone();
        tauri::async_runtime::spawn(async move {
          if let Err(e) = tokio::task::spawn_blocking(move || {
            let db_state = handle3.state::<db::DbState>();
            let token_cache = handle3.state::<db::TokenCache>();
            commands::do_prefetch_comments(&handle3, &db_state, &token_cache);
          })
          .await
          {
            eprintln!("[prefetch] task panicked: {e}");
          }
        });
      }
      Ok(Err(e)) => eprintln!("[poll] sync error: {e}"),
      Err(e) => eprintln!("[poll] task panicked: {e}"),
    }
  }
}
