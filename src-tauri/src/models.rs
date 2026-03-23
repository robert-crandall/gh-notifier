use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
  pub id: i64,
  pub name: String,
  pub context_doc: String,
  pub next_action: String,
  pub status: String,              // "active" | "snoozed"
  pub snooze_mode: Option<String>, // "manual" | "date" | "notification"
  pub snooze_until: Option<String>,
  pub unread_count: i64,
  pub icon: String,
  pub repo_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubNotification {
  pub id: i64,
  pub github_id: String,
  pub repo_full_name: String,
  pub subject_title: String,
  pub subject_type: String, // "PullRequest" | "Issue" | "Release" | "Discussion"
  pub subject_url: Option<String>,
  pub reason: String,
  pub is_read: bool,
  pub updated_at: String,
  pub project_id: Option<i64>,
  pub author: String,
  pub author_avatar: Option<String>,
  pub html_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManualTask {
  pub id: i64,
  pub title: String,
  pub is_done: bool,
  pub project_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
  pub github_token: Option<String>,
  pub poll_interval_minutes: i64,
  pub is_setup_complete: bool,
  pub last_synced_at: Option<String>,
}

/// Returned by `assign_notification_to_project` to let the UI decide whether to
/// offer a repo-level routing rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoRoutingHint {
  /// `"none"` | `"opt_in"` | `"opt_out"`
  pub kind: String,
  pub repo_full_name: String,
  pub project_id: i64,
  pub project_name: String,
  /// Number of pre-existing thread mappings for this repo (used for the
  /// optional migration prompt when the user accepts the repo rule).
  pub existing_thread_count: i64,
  /// Number of unmapped inbox notifications from this repo that will be
  /// auto-routed when the repo rule is created (no separate prompt needed).
  pub inbox_notification_count: i64,
}
