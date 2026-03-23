use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT};
use serde::Deserialize;

// ---------------------------------------------------------------------------
// GitHub API response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ApiNotification {
  pub id: String,
  pub repository: ApiRepository,
  pub subject: ApiSubject,
  pub reason: String,
  pub unread: bool,
  pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct ApiRepository {
  pub full_name: String,
}

#[derive(Debug, Deserialize)]
pub struct ApiSubject {
  pub title: String,
  pub url: Option<String>,
  #[serde(rename = "type")]
  pub subject_type: String,
}

// ---------------------------------------------------------------------------
// HTTP client factory
// ---------------------------------------------------------------------------

fn make_client(token: &str) -> Result<Client, String> {
  let mut headers = HeaderMap::new();
  let auth = HeaderValue::from_str(&format!("Bearer {token}"))
    .map_err(|e| format!("Invalid token characters: {e}"))?;
  headers.insert(AUTHORIZATION, auth);
  headers.insert(
    ACCEPT,
    HeaderValue::from_static("application/vnd.github+json"),
  );
  headers.insert(
    "X-GitHub-Api-Version",
    HeaderValue::from_static("2022-11-28"),
  );
  headers.insert(USER_AGENT, HeaderValue::from_static("gh-notifier/0.1"));

  Client::builder()
    .default_headers(headers)
    .build()
    .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

/// Validate that `token` is a working GitHub PAT.
/// Calls `GET /user` — returns Err with a human-readable message on failure.
pub fn validate_token(token: &str) -> Result<(), String> {
  let client = make_client(token)?;
  let resp = client
    .get("https://api.github.com/user")
    .send()
    .map_err(|e| format!("Network error: {e}"))?;

  if resp.status().is_success() {
    Ok(())
  } else if resp.status().as_u16() == 401 {
    Err("Invalid token: GitHub returned 401 Unauthorized. Check the PAT and its scopes.".into())
  } else {
    Err(format!("GitHub returned status {}", resp.status()))
  }
}

/// Fetch all unread notifications from `GET /notifications`.
/// Returns `team_mention` notifications as well — callers are responsible for filtering.
pub fn fetch_notifications(token: &str) -> Result<Vec<ApiNotification>, String> {
  let client = make_client(token)?;
  // `all=false` (default) returns only unread; we use that to stay lean.
  let resp = client
    .get("https://api.github.com/notifications")
    .send()
    .map_err(|e| format!("Network error: {e}"))?;

  if !resp.status().is_success() {
    return Err(format!("GitHub returned status {}", resp.status()));
  }

  resp
    .json::<Vec<ApiNotification>>()
    .map_err(|e| format!("Failed to parse GitHub notifications response: {e}"))
}

/// Unsubscribe from a GitHub notification thread.
/// Calls `DELETE /notifications/threads/{thread_id}/subscription`.
pub fn unsubscribe_thread(token: &str, thread_id: &str) -> Result<(), String> {
  let client = make_client(token)?;
  let url = format!("https://api.github.com/notifications/threads/{thread_id}/subscription");
  let resp = client
    .delete(&url)
    .send()
    .map_err(|e| format!("Network error: {e}"))?;

  // 204 No Content = success.  404 means already unsubscribed — treat as OK.
  if resp.status().is_success() || resp.status().as_u16() == 404 {
    Ok(())
  } else {
    Err(format!(
      "GitHub unsubscribe returned status {}",
      resp.status()
    ))
  }
}

// ---------------------------------------------------------------------------
// URL resolution helpers
// ---------------------------------------------------------------------------

/// Convert a GitHub REST API URL for an issue or PR into a browser-friendly
/// HTML URL.  Returns `None` if the URL format is not recognised.
///
/// Examples:
/// - `https://api.github.com/repos/owner/repo/issues/42`
///   → `https://github.com/owner/repo/issues/42`
/// - `https://api.github.com/repos/owner/repo/pulls/7`
///   → `https://github.com/owner/repo/pull/7`
pub fn api_url_to_html_url(url: &str) -> Option<String> {
  let path = url.strip_prefix("https://api.github.com/repos/")?;
  // path is now:  owner/repo/issues/42  or  owner/repo/pulls/7  etc.

  // Split off the first two segments (owner/repo) from the rest.
  let mut parts = path.splitn(4, '/');
  let owner = parts.next()?;
  let repo = parts.next()?;
  let kind = parts.next()?;
  let rest = parts.next().unwrap_or("");

  let html = match kind {
    "issues" => format!("https://github.com/{owner}/{repo}/issues/{rest}"),
    "pulls" => format!("https://github.com/{owner}/{repo}/pull/{rest}"),
    "releases" => format!("https://github.com/{owner}/{repo}/releases"),
    "commits" => format!("https://github.com/{owner}/{repo}/commit/{rest}"),
    _ => format!("https://github.com/{owner}/{repo}"),
  };

  Some(html)
}

#[cfg(test)]
mod tests {
  use super::api_url_to_html_url;

  #[test]
  fn converts_issue_url() {
    assert_eq!(
      api_url_to_html_url("https://api.github.com/repos/owner/repo/issues/42"),
      Some("https://github.com/owner/repo/issues/42".into())
    );
  }

  #[test]
  fn converts_pr_url() {
    assert_eq!(
      api_url_to_html_url("https://api.github.com/repos/owner/repo/pulls/7"),
      Some("https://github.com/owner/repo/pull/7".into())
    );
  }

  #[test]
  fn returns_none_for_unknown() {
    assert_eq!(api_url_to_html_url("https://example.com/foo"), None);
  }
}
