use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub context_doc: String,
    pub next_action: String,
    pub status: String,            // "active" | "snoozed"
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
}
