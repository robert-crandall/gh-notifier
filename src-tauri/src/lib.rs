mod commands;
mod db;
mod github;
mod models;

use commands::{
  assign_notification_to_project, create_manual_task, create_project, delete_project,
  get_manual_tasks, get_notifications, get_project, get_projects, get_settings,
  get_unmapped_notifications, mark_notification_read, save_github_token, snooze_project,
  sync_notifications, toggle_manual_task, unsubscribe_thread, update_project, wake_project,
};
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
             AND snooze_until IS NOT NULL AND snooze_until <= datetime('now')",
          [],
        )
        .map_err(std::io::Error::other)?;
      app.manage(db::DbState(std::sync::Mutex::new(conn)));
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
      sync_notifications,
      get_manual_tasks,
      create_manual_task,
      toggle_manual_task,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
