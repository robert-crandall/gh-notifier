mod commands;
mod models;

use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
