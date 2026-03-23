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

/// Build a `reqwest::blocking::Client` with GitHub API headers.
/// Exported for use by callers that need to make multiple GitHub API requests
/// in a batch (e.g., `process_notifications` reuses one client for all
/// terminal-state checks to avoid per-notification construction overhead).
pub fn make_client_public(token: &str) -> Result<Client, String> {
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
  let client = make_client_public(token)?;
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

/// Fetch all unread notifications from `GET /notifications`, following pagination.
/// When `since` is `Some(ts)`, only notifications updated after that timestamp are
/// returned — GitHub will serve a 304 (empty body) when nothing changed, which we
/// transparently normalise to an empty `Vec`.
/// Returns `team_mention` notifications as well — callers are responsible for filtering.
pub fn fetch_notifications(
  token: &str,
  since: Option<&str>,
) -> Result<Vec<ApiNotification>, String> {
  fn parse_next_link(link_header: &str) -> Option<String> {
    // Link: <url1>; rel="next", <url2>; rel="prev", ...
    for part in link_header.split(',') {
      let mut sections = part.trim().split(';');
      let url_part = sections.next()?.trim();
      let rel_part = sections.find(|s| s.trim().starts_with("rel="))?;
      if rel_part.contains("next") {
        if let Some(start) = url_part.find('<') {
          if let Some(end) = url_part.find('>') {
            if end > start + 1 {
              return Some(url_part[start + 1..end].to_string());
            }
          }
        }
      }
    }
    None
  }

  let client = make_client_public(token)?;
  // `all=false` (default) returns only unread; we use that to stay lean.
  let mut all_notifications = Vec::new();
  let base = "https://api.github.com/notifications?per_page=100";
  let mut url = match since {
    Some(ts) => format!("{base}&since={ts}"),
    None => base.to_string(),
  };

  loop {
    let resp = client
      .get(&url)
      .send()
      .map_err(|e| format!("Network error: {e}"))?;

    if !resp.status().is_success() {
      // 304 Not Modified: nothing changed since `since` timestamp — return empty.
      if resp.status().as_u16() == 304 {
        break;
      }
      return Err(format!("GitHub returned status {}", resp.status()));
    }

    let next_url = resp
      .headers()
      .get("Link")
      .and_then(|v| v.to_str().ok())
      .and_then(parse_next_link);

    let mut page = resp
      .json::<Vec<ApiNotification>>()
      .map_err(|e| format!("Failed to parse GitHub notifications response: {e}"))?;

    all_notifications.append(&mut page);

    match next_url {
      Some(u) => {
        url = u;
      }
      None => break,
    }
  }

  Ok(all_notifications)
}

/// Fetch the subject URL for an Issue or Pull Request and return `true` if it
/// is in a terminal state (closed issue, or closed/merged PR).
///
/// Accepts a reference to an existing `Client` to avoid reconstruction overhead
/// during batch processing (e.g., syncing hundreds of notifications).
///
/// Returns `false` for non-PR/Issue subject types, or on any network/parse
/// error — callers should treat failures as "not terminal" and move on.
pub fn fetch_is_terminal(client: &Client, subject_url: &str, subject_type: &str) -> bool {
  #[derive(Deserialize)]
  struct SubjectState {
    state: Option<String>,
    merged: Option<bool>,
  }

  if subject_type != "PullRequest" && subject_type != "Issue" {
    return false;
  }

  let Ok(resp) = client.get(subject_url).send() else {
    return false;
  };
  if !resp.status().is_success() {
    return false;
  }
  let detail: SubjectState = match resp.json() {
    Ok(d) => d,
    Err(_) => return false,
  };
  match subject_type {
    "PullRequest" => detail.merged.unwrap_or(false) || detail.state.as_deref() == Some("closed"),
    "Issue" => detail.state.as_deref() == Some("closed"),
    _ => false,
  }
}

/// Mark a GitHub notification thread as read.
/// Calls `PATCH /notifications/threads/{thread_id}`.
/// This prevents the thread from reappearing on the next `GET /notifications` sync.
pub fn mark_thread_read(token: &str, thread_id: &str) -> Result<(), String> {
  let client = make_client_public(token)?;
  let url = format!("https://api.github.com/notifications/threads/{thread_id}");
  let resp = client
    .patch(&url)
    .send()
    .map_err(|e| format!("Network error: {e}"))?;

  // 205 Reset Content = success.  404 means thread not found — treat as OK.
  if resp.status().is_success() || resp.status().as_u16() == 404 {
    Ok(())
  } else {
    Err(format!(
      "GitHub mark-as-read returned status {}",
      resp.status()
    ))
  }
}

/// Unsubscribe from a GitHub notification thread.
/// Calls `DELETE /notifications/threads/{thread_id}/subscription`.
pub fn unsubscribe_thread(token: &str, thread_id: &str) -> Result<(), String> {
  let client = make_client_public(token)?;
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
