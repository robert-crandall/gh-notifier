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
  /// `true` when the underlying thread is closed/merged — auto-marked read
  /// and shown in a collapsed "Closed" section rather than active threads.
  pub is_terminal: bool,
  /// `true` when the user has flagged this notification as requiring action.
  /// Flagged notifications remain in the Active Threads view even after being
  /// marked read.
  pub action_needed: bool,
  /// Latest comment prefetched in the background after sync.
  /// Cleared when `updated_at` changes (new activity on the thread).
  pub comment_body: Option<String>,
  pub comment_author: Option<String>,
  pub comment_avatar: Option<String>,
  pub comment_at: Option<String>,
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

/// A repo-level routing rule stored in `repo_rules`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoRule {
  pub id: i64,
  pub repo_full_name: String,
  pub project_id: i64,
  pub project_name: String,
  pub created_at: String,
}

/// Kind of repo-level routing hint.
///
/// Serialized as `"none" | "opt_in" | "opt_out"` for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepoRoutingKind {
  None,
  OptIn,
  OptOut,
}

/// A project bookmark — a named link associated with a project.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
  pub id: i64,
  pub project_id: i64,
  pub name: String,
  pub url: String,
}

/// Returned by `assign_notification_to_project` to let the UI decide whether to
/// offer a repo-level routing rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoRoutingHint {
  /// `"none"` | `"opt_in"` | `"opt_out"`
  pub kind: RepoRoutingKind,
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

/// A global filter — suppresses a notification reason across all repos.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalFilter {
  pub id: i64,
  pub reason: String,
  pub created_at: String,
}

/// A per-repo filter — suppresses a notification reason for a specific repo.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoFilter {
  pub id: i64,
  pub repo_full_name: String,
  pub reason: String,
  pub created_at: String,
}
