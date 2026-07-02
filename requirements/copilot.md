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
| `state` is `completed`, `cancelled`, or `failed` | `completed` |
| `state` is not terminal, `pullRequestState` is `"OPEN"` | `pr_ready` |
| `state` is `idle` | `waiting` |
| Otherwise (non-terminal, no open PR, not idle) | `in_progress` |

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
| `github` | 1. PR notification thread already routed to a project → use that project. 2. Repo rules (`repo_rules` table — exact repo match). 3. Routing rules (`routing_rules` table — first match wins). |

If no rule matches, `project_id = null`. Unlinked sessions are stored but not surfaced in any project tab.

---

## IPC Channels

```
copilot:sessions-for-project   args: [projectId: number]              result: CopilotSession[]
copilot:all-statuses           args: []                                result: Record<number, CopilotSessionStatus>
copilot:sync                   args: []                                result: void
copilot:launch                 args: [payload: LaunchAgentTaskPayload] result: CopilotSession
copilot:unassigned             args: []                                result: CopilotSession[]
copilot:unassigned-count       args: []                                result: number
copilot:assign                 args: [sessionId, projectId]            result: void
copilot:launch-targets         args: [projectId: number]              result: LaunchTarget[]
```

A push event `onCopilotUpdated` is added to `ElectronApi` (same pattern as `onNotificationsUpdated`) to notify the renderer when session state changes.

---

## MVP B — Launch + Track (evolution of the read-only design)

MVP B evolves the integration above from read-only tracking to **launch + track**.
Everything below is additive; the `gh agent-task list` sync, rail dot, and digest
folding from MVP A are reused unchanged in shape.

### Launching a task

- `copilot:launch` shells out to `gh agent-task create -R <owner>/<repo> [-b <base>]`
  off the render thread, piping the prompt on stdin (`-F -`). Launchable from a
  next action, a todo, or a notification via a small **Delegate to Copilot**
  confirm composer (not pure one-click: a cloud launch spends premium requests and
  can't be cleanly undone read-only).
- `create` prints the agent-session URL (`…/pull/<n>/agent-sessions/<uuid>`); we
  parse the session UUID + PR number and **optimistically insert** a
  `copilot_sessions` row (status `in_progress`) so the rail/digest light up before
  the next list sync. A background sync then reconciles the real title/status.
- **Auth:** `gh agent-task` requires gh's keyring OAuth token. The subprocess env
  strips `GH_TOKEN`/`GITHUB_TOKEN` (which agent-task rejects) for the `agent-task`
  calls only.

### Sticky project assignment (`pinned_project_id`)

A launched (or manually assigned) session must stay on its project, but the list
sync re-resolves project every cycle and a just-launched task usually resolves to
null. A `pinned_project_id` column records the explicit intent: the sync UPSERT
preserves it and prefers it (when the project is live) over auto-resolution. On
project delete both `project_id` and `pinned_project_id` are nulled so the session
drops to the Unassigned surface.

### Status derivation

`deriveStatus` makes the task lifecycle win over PR existence (a launch opens a
draft PR immediately): `completed` + open PR → `pr_ready`; `completed` +
merged/closed → `completed`; `failed`/`cancelled` → `completed`; `idle` →
`waiting`; else → `in_progress`.

### Unassigned surface ("Agent tasks")

A dedicated rail entry near Inbox, badged with the count of **active** unassigned
sessions, opening a list of sessions with `project_id IS NULL` (active-first, then
newest, incl. recently-completed). Each row can be assigned to a project
(`copilot:assign`, sticky) or opened on GitHub.

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

- Writing back to GitHub beyond **launching a cloud `gh agent-task`** and the existing unsubscribe (no commenting, requesting reviews, or cancelling a task)
- Tracking Copilot code completions or inline suggestions
- Showing full Copilot session transcripts inline in the app
- The embedded/local Copilot CLI agent — live streaming, permission cards, worktree sandbox (that's a later milestone, MVP D)
- Any cross-machine or cloud sync of local session state
