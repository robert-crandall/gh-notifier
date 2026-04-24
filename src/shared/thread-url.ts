import type { NotificationThread } from './ipc-channels'

type ThreadUrlInput = Pick<NotificationThread, 'htmlUrl' | 'subjectUrl' | 'repoOwner' | 'repoName'>

/**
 * Constructs the best available browser URL for a notification thread.
 *
 * Priority:
 * 1. htmlUrl       — resolved direct link set after content prefetch (preferred)
 * 2. subjectUrl    — GitHub API URL converted to a browser URL
 * 3. Repo fallback — the repository page when neither link is available
 *
 * subjectUrl format:  https://api.github.com/repos/{owner}/{repo}/issues/{n}
 *                 or  https://api.github.com/repos/{owner}/{repo}/pulls/{n}
 * Browser URL format: https://github.com/{owner}/{repo}/issues/{n}
 *                 or  https://github.com/{owner}/{repo}/pull/{n}
 */
export function buildThreadUrl(thread: ThreadUrlInput): string {
  if (thread.htmlUrl) {
    return thread.htmlUrl
  }

  if (thread.subjectUrl) {
    return thread.subjectUrl
      .replace('https://api.github.com/repos/', 'https://github.com/')
      .replace('/pulls/', '/pull/')
  }

  return `https://github.com/${thread.repoOwner}/${thread.repoName}`
}
