import type { AppDelegateFallbackReason, CopilotSession } from '@shared/ipc-channels'

/** Exhaustiveness guard: adding a fallback reason forces a copy update here. */
function unhandledFallback(reason: never): string {
  console.warn('[FocusPage] Unhandled delegate fallback reason:', reason)
  return "The desktop app couldn't take this, so I sent it to the cloud."
}

/**
 * Honest, per-reason copy for a delegate that landed in the cloud instead of the
 * desktop app. Every reason is surfaced (no silent generic hide) so the user
 * always knows the desktop app was bypassed and why.
 */
export function cloudFallbackMessage(reason: AppDelegateFallbackReason, session: CopilotSession): string {
  const repo = session.repoOwner && session.repoName ? `${session.repoOwner}/${session.repoName}` : 'this repo'
  switch (reason) {
    case 'flag_disabled':
      return 'Desktop handoff is disabled, so I sent this to the cloud.'
    case 'app_not_running':
      return "The Copilot app isn't running, so I sent this to the cloud instead."
    case 'app_unavailable':
      return "Couldn't reach the Copilot app, so I sent this to the cloud instead."
    case 'no_local_cwd':
      return (
        `I couldn't resolve a trusted local checkout for ${repo}, so I sent it to the cloud. ` +
        'Clone it under your configured repos root (default ~/repos) to hand off to the desktop app.'
      )
    case 'base_branch':
      return "I used the cloud agent because this task specifies a base branch - desktop handoff doesn't support that yet."
    default:
      return unhandledFallback(reason)
  }
}
