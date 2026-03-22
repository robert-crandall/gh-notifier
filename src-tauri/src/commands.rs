use crate::models::{AppSettings, GithubNotification, ManualTask, Project};

fn stub_projects() -> Vec<Project> {
  vec![
        Project {
            id: 1,
            name: "core-engine-v2".into(),
            context_doc: "**Goals:**\n- Decouple the monolithic event stream.\n- Transition to gRPC for internal service comms.\n\n**Constraints:**\n- Zero downtime requirement.\n- Must maintain backwards compatibility with v2 legacy clients.".into(),
            next_action: "Review critical PR #442: Refactor memory allocator for low-latency nodes.".into(),
            status: "active".into(),
            snooze_mode: None,
            snooze_until: None,
            unread_count: 3,
            icon: "terminal".into(),
            repo_label: "Precision-Architect/Core".into(),
        },
        Project {
            id: 2,
            name: "api-gateway-mesh".into(),
            context_doc: "Service mesh gateway for internal microservices.\n\nKey components: Envoy proxy, custom load balancer, mTLS cert rotation.".into(),
            next_action: "Validate security manifest for the new ingress controller.".into(),
            status: "active".into(),
            snooze_mode: None,
            snooze_until: None,
            unread_count: 1,
            icon: "data_object".into(),
            repo_label: "Precision-Architect/Infra".into(),
        },
        Project {
            id: 3,
            name: "ui-component-library".into(),
            context_doc: "Shared component library for all frontend applications.\n\nDesign system tokens, Storybook, accessibility audit pending.".into(),
            next_action: "Export tokens for the new \"Digital Lithograph\" theme.".into(),
            status: "active".into(),
            snooze_mode: None,
            snooze_until: None,
            unread_count: 0,
            icon: "dashboard_customize".into(),
            repo_label: "Precision-Architect/Design".into(),
        },
        Project {
            id: 4,
            name: "legacy-auth-service".into(),
            context_doc: "Legacy authentication service pending migration.".into(),
            next_action: "Pending dependency update.".into(),
            status: "snoozed".into(),
            snooze_mode: Some("date".into()),
            snooze_until: Some("2026-10-24T09:00:00".into()),
            unread_count: 0,
            icon: "push_pin".into(),
            repo_label: "Precision-Architect/Auth".into(),
        },
        Project {
            id: 5,
            name: "marketing-analytics-tracker".into(),
            context_doc: "Analytics tracker for marketing campaigns.".into(),
            next_action: "Awaiting Q4 growth metrics.".into(),
            status: "snoozed".into(),
            snooze_mode: Some("notification".into()),
            snooze_until: None,
            unread_count: 0,
            icon: "analytics".into(),
            repo_label: "Precision-Architect/Analytics".into(),
        },
        Project {
            id: 6,
            name: "experimental-webgpu-renderer".into(),
            context_doc: "Experimental WebGPU rendering engine.".into(),
            next_action: "On ice: GPU driver bug in Chrome 128.".into(),
            status: "snoozed".into(),
            snooze_mode: Some("manual".into()),
            snooze_until: None,
            unread_count: 0,
            icon: "experiment".into(),
            repo_label: "Precision-Architect/Render".into(),
        },
    ]
}

fn stub_notifications() -> Vec<GithubNotification> {
  vec![
    GithubNotification {
      id: 101,
      github_id: "gh_101".into(),
      repo_full_name: "precision-architect/core-engine".into(),
      subject_title: "PR #42: Update login logic and implement OAuth2 flow".into(),
      subject_type: "PullRequest".into(),
      subject_url: Some("https://github.com/precision-architect/core-engine/pull/42".into()),
      reason: "review_requested".into(),
      is_read: false,
      updated_at: "2026-03-22T10:00:00Z".into(),
      project_id: Some(1),
      author: "dev_user".into(),
      author_avatar: None,
    },
    GithubNotification {
      id: 102,
      github_id: "gh_102".into(),
      repo_full_name: "precision-architect/infra-ops".into(),
      subject_title: "Issue #891: Redis cluster cache eviction policy mismatch".into(),
      subject_type: "Issue".into(),
      subject_url: Some("https://github.com/precision-architect/infra-ops/issues/891".into()),
      reason: "assign".into(),
      is_read: true,
      updated_at: "2026-03-21T14:00:00Z".into(),
      project_id: Some(1),
      author: "ops_lead".into(),
      author_avatar: None,
    },
    GithubNotification {
      id: 103,
      github_id: "gh_103".into(),
      repo_full_name: "precision-architect/core-engine".into(),
      subject_title: "Code Review: New worker pool implementation".into(),
      subject_type: "PullRequest".into(),
      subject_url: Some("https://github.com/precision-architect/core-engine/pull/55".into()),
      reason: "review_requested".into(),
      is_read: false,
      updated_at: "2026-03-22T08:00:00Z".into(),
      project_id: Some(1),
      author: "lead_dev".into(),
      author_avatar: None,
    },
    // Unmapped notifications (inbox)
    GithubNotification {
      id: 201,
      github_id: "gh_201".into(),
      repo_full_name: "UI-Components".into(),
      subject_title: "Refactor global navigation state to use context-aware anchors".into(),
      subject_type: "PullRequest".into(),
      subject_url: Some("https://github.com/ui-components/pull/442".into()),
      reason: "review_requested".into(),
      is_read: false,
      updated_at: "2026-03-22T09:00:00Z".into(),
      project_id: None,
      author: "alec_dev".into(),
      author_avatar: None,
    },
    GithubNotification {
      id: 202,
      github_id: "gh_202".into(),
      repo_full_name: "Core-Engine".into(),
      subject_title: "Memory leak detected during long-running Git sync cycles".into(),
      subject_type: "Issue".into(),
      subject_url: Some("https://github.com/core-engine/issues/89".into()),
      reason: "assign".into(),
      is_read: false,
      updated_at: "2026-03-22T00:00:00Z".into(),
      project_id: None,
      author: "sarah_ops".into(),
      author_avatar: None,
    },
    GithubNotification {
      id: 203,
      github_id: "gh_203".into(),
      repo_full_name: "Docs".into(),
      subject_title: "Update README with new architectural patterns and CLI flags".into(),
      subject_type: "PullRequest".into(),
      subject_url: Some("https://github.com/docs/pull/12".into()),
      reason: "mention".into(),
      is_read: true,
      updated_at: "2026-03-21T08:00:00Z".into(),
      project_id: None,
      author: "mika_writes".into(),
      author_avatar: None,
    },
  ]
}

fn stub_settings() -> AppSettings {
  AppSettings {
    github_token: Some("ghp_stub_token_for_development".into()),
    poll_interval_minutes: 5,
    is_setup_complete: true,
  }
}

#[tauri::command]
pub fn get_projects() -> Vec<Project> {
  stub_projects()
}

#[tauri::command]
pub fn get_project(id: i64) -> Result<Project, String> {
  stub_projects()
    .into_iter()
    .find(|p| p.id == id)
    .ok_or_else(|| format!("Project {id} not found"))
}

#[tauri::command]
pub fn create_project(name: String) -> Project {
  Project {
    id: 99,
    name,
    context_doc: String::new(),
    next_action: String::new(),
    status: "active".into(),
    snooze_mode: None,
    snooze_until: None,
    unread_count: 0,
    icon: "folder".into(),
    repo_label: String::new(),
  }
}

#[tauri::command]
pub fn update_project(_project: Project) {
  // Stub: no-op
}

#[tauri::command]
pub fn delete_project(_id: i64) {
  // Stub: no-op
}

#[tauri::command]
pub fn snooze_project(_id: i64, _mode: String, _until: Option<String>) {
  // Stub: no-op
}

#[tauri::command]
pub fn wake_project(_id: i64) {
  // Stub: no-op
}

#[tauri::command]
pub fn get_notifications(project_id: Option<i64>) -> Vec<GithubNotification> {
  let all = stub_notifications();
  match project_id {
    Some(pid) => all
      .into_iter()
      .filter(|n| n.project_id == Some(pid))
      .collect(),
    None => all,
  }
}

#[tauri::command]
pub fn get_unmapped_notifications() -> Vec<GithubNotification> {
  stub_notifications()
    .into_iter()
    .filter(|n| n.project_id.is_none())
    .collect()
}

#[tauri::command]
pub fn assign_notification_to_project(_notification_id: i64, _project_id: i64) {
  // Stub: no-op
}

#[tauri::command]
pub fn mark_notification_read(_id: i64) {
  // Stub: no-op
}

#[tauri::command]
pub fn unsubscribe_thread(_id: i64) {
  // Stub: no-op
}

#[tauri::command]
pub fn get_settings() -> AppSettings {
  stub_settings()
}

#[tauri::command]
pub fn save_github_token(_token: String) {
  // Stub: no-op
}

#[tauri::command]
pub fn sync_notifications() {
  // Stub: no-op
}

#[tauri::command]
pub fn get_manual_tasks(_project_id: Option<i64>) -> Vec<ManualTask> {
  vec![
    ManualTask {
      id: 1,
      title: "Write migration plan for auth service".into(),
      is_done: false,
      project_id: Some(1),
    },
    ManualTask {
      id: 2,
      title: "Schedule team sync for Q3 planning".into(),
      is_done: true,
      project_id: None,
    },
  ]
}

#[tauri::command]
pub fn create_manual_task(title: String, project_id: Option<i64>) -> ManualTask {
  ManualTask {
    id: 99,
    title,
    is_done: false,
    project_id,
  }
}

#[tauri::command]
pub fn toggle_manual_task(_id: i64) {
  // Stub: no-op
}
