import type { NotificationThread } from './ipc-channels'

type ThreadUrlInput = Pick<NotificationThread, 'htmlUrl' | 'subjectUrl' | 'repoOwner' | 'repoName'>

function buildBrowserUrlFromSubjectUrl(thread: ThreadUrlInput): string | null {
  if (!thread.subjectUrl) {
    return null
  }

  let parsed: URL

  try {
    parsed = new URL(thread.subjectUrl)
  } catch {
    return null
  }

  if (parsed.origin !== 'https://api.github.com') {
    return null
  }

  const match = parsed.pathname.match(
    /^\/repos\/([^/]+)\/([^/]+)\/(issues|pulls|commits)\/([^/]+)$/
  )

  if (!match) {
    return null
  }

  const [, owner, repo, resource, identifier] = match

  if (owner !== thread.repoOwner || repo !== thread.repoName) {
    return null
  }

  if (resource === 'issues') {
    return `https://github.com/${owner}/${repo}/issues/${identifier}`
  }

  if (resource === 'pulls') {
    return `https://github.com/${owner}/${repo}/pull/${identifier}`
  }

  if (resource === 'commits') {
    return `https://github.com/${owner}/${repo}/commit/${identifier}`
  }

  return null
}

/**
 * Constructs the best available browser URL for a notification thread.
 *
 * Priority:
 * 1. htmlUrl       — resolved direct link set after content prefetch (preferred)
 * 2. subjectUrl    — GitHub API URL converted to a browser URL when the API path is known-safe
 * 3. Repo fallback — the repository page when neither link is available
 *
 * Supported subjectUrl formats:
 *   https://api.github.com/repos/{owner}/{repo}/issues/{n}
 *   https://api.github.com/repos/{owner}/{repo}/pulls/{n}
 *   https://api.github.com/repos/{owner}/{repo}/commits/{sha}
 */
export function buildThreadUrl(thread: ThreadUrlInput): string {
  if (thread.htmlUrl) {
    return thread.htmlUrl
  }

  const subjectBrowserUrl = buildBrowserUrlFromSubjectUrl(thread)

  if (subjectBrowserUrl) {
    return subjectBrowserUrl
  }

  return `https://github.com/${thread.repoOwner}/${thread.repoName}`
}
