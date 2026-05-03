# Copilot Session Integration

## Overview

Surface GitHub Copilot coding agent activity inside GH Projects. The user should be able to see — at a glance in the project sidebar — whether any Copilot session is in progress or waiting for their attention, and drill into those sessions via a dedicated tab on the project detail view.

---

## Session Sources

The app tracks GitHub agent task sessions only.

### GitHub-assigned sessions (`source: 'github'`)

When the user starts a Copilot coding agent task on GitHub (via an issue, a prompt, or any other entry point), the task appears in `gh agent-task list`. This is the authoritative source for sessions — no REST API calls.

**Data source:** Spawn `gh agent-task list` as a child process with `--json id,name,state,repository,createdAt,updatedAt,completedAt,pullRequestUrl,pullRequestState,pullRequestTitle,pullRequestNumber`. Parse the JSON array from stdout. Any non-zero exit code or parse failure logs a warning and is skipped — never crash the app.

**Field mapping:**

| `gh agent-task list` field | `CopilotSession` field |
|---|---|
| `id` | `id` (task UUID) |
| `name` | `title` |
| `repository` (`"owner/name"` or `null`) | `repoOwner`, `repoName` (split on `/`) |
| `createdAt` | `startedAt` |
| `updatedAt` | `updatedAt` |
| `pullRequestUrl` | `linkedPrUrl`, `htmlUrl` |

**Status derivation:**

| Condition | Status |
|---|---|
| `state` is not `completed`, `cancelled`, or `failed`, and `pullRequestUrl` is `null` | `in_progress` |
| `state` is not `completed`, `cancelled`, or `failed`, and `pullRequestState` is `"OPEN"` | `pr_ready` |
| `state` is `completed`, `cancelled`, or `failed` | `completed` |

**Sync cadence:** Piggyback on the existing notification sync interval. No separate timer.

---

## Data Model

### `CopilotSession`

```ts
interface CopilotSession {
  id: string                        // gh agent-task UUID
  projectId: number | null          // null = unlinked (no matching repo rule)
  source: 'github'
  status: CopilotSessionStatus
  title: string                     // issue title from the agent task
  htmlUrl: string | null            // URL to the issue/PR on github.com
  startedAt: string                 // ISO 8601
  updatedAt: string                 // ISO 8601
  repoOwner: string | null          // resolved repo owner (for display + linking)
  repoName: string | null           // resolved repo name
  branch: string | null             // reserved for future use
  linkedPrUrl: string | null        // PR opened by Copilot for this task
}

type CopilotSessionStatus =
  | 'in_progress'   // agent is actively working
  | 'waiting'       // agent finished a turn, waiting for user input
  | 'pr_ready'      // PR opened and ready for review (github source only)
  | 'completed'     // issue closed, PR merged, or session timed out
```

### Project `copilotStatus`

The `Project` type gains a computed `copilotStatus: CopilotSessionStatus | null` field, derived server-side when listing projects:

- `null` — no active sessions for this project
- `'in_progress'` — at least one session with status `in_progress`
- `'waiting'` — at least one session with status `waiting` or `pr_ready`, and none with `in_progress`

Joined into the `projects:list` query so no extra IPC round-trip is needed for the sidebar.

### Project linking

| Source | How project is resolved |
|---|---|
| `github` | The task's repo → matched against `repo_rules` |

If no rule matches, `project_id = null`. Unlinked sessions are stored but not surfaced in any project tab.

---

## IPC Channels

```
copilot:sessions-for-project   args: [projectId: number]   result: CopilotSession[]
copilot:all-statuses           args: []                     result: Record<number, CopilotSessionStatus>
copilot:sync                   args: []                     result: void
```

A push event `onCopilotUpdated` is added to `ElectronApi` (same pattern as `onNotificationsUpdated`) to notify the renderer when session state changes.

---

## UI

### Sidebar status indicator

A small dot appears next to the project name in the sidebar:

| Dot | Meaning |
|---|---|
| Animated pulse (accent color) | `in_progress` |
| Static amber dot | `waiting` or `pr_ready` |
| No dot | `null` or `completed` |

### Project detail — Copilot tab

A new `copilot` tab in the project detail view (alongside todos, notes, notifications). The tab is hidden if the project has no sessions (current or historical).

The tab renders a session list with sessions grouped by status. Each row shows:
- Status icon
- Title (issue title or task name)
- Source badge (`github`)
- "Started X ago" relative timestamp
- Link button to open the issue/PR in the browser

---

## Out of Scope

- Writing back to GitHub (e.g. commenting on issues, requesting reviews) — read-only only
- Tracking Copilot code completions or inline suggestions
- Showing full Copilot session transcripts inline in the app
- Spawning, resuming, or controlling Copilot CLI sessions from this app
- Any cross-machine or cloud sync of local session state
