# Copilot Session Integration

## Overview

Surface GitHub Copilot coding agent activity inside GH Projects. The user should be able to see — at a glance in the project sidebar — whether any Copilot session is in progress or waiting for their attention, and drill into those sessions via a dedicated tab on the project detail view.

---

## Session Sources

Copilot work happens in three places. We track all of them.

### 1. GitHub-assigned sessions (`source: 'github'`)

When the user starts a Copilot coding agent task on GitHub (via an issue, a prompt, or any other entry point), the task appears in `gh agent-task list`. This is the authoritative source for GitHub-side sessions — no REST API calls.

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

### 2. Copilot CLI sessions (`source: 'cli'`)

When the user runs the Copilot CLI (in agent mode, including from terminal or from the integrated VS Code Copilot Chat agent panel), session state is written to `~/.copilot/session-state/<session-uuid>/`. This is the primary local source.

**Files per session:**

| File | Contents |
|---|---|
| `workspace.yaml` | `id`, `cwd`, `git_root`, `repository` (`owner/name`), `branch`, `host_type`, `summary`, `created_at`, `updated_at` |
| `events.jsonl` | Append-only event log (see "JSONL event format" below) |
| `session.db` | Per-session SQLite — not consumed by this app |

The `repository` field directly gives us `owner/name`, so project linking is straightforward — no git remote parsing required.

### 3. VS Code Copilot Chat sessions (`source: 'vscode-chat'`)

Older / separate Copilot Chat panel sessions live in VS Code's workspace storage:

- `~/Library/Application Support/Code - Insiders/User/workspaceStorage/<hash>/GitHub.copilot-chat/transcripts/<session-id>.jsonl`
- `~/Library/Application Support/Code/User/workspaceStorage/<hash>/GitHub.copilot-chat/transcripts/<session-id>.jsonl`

The workspace hash is mapped to a repo via the sibling `workspace.json` (e.g. `{ "folder": "file:///Users/.../repos/my-project" }`). The repo path is then resolved to a GitHub remote and matched against `repo_rules` to find the project.

Both Stable and Insiders paths are checked.

### JSONL event format (shared by sources 2 and 3)

| Event | Meaning |
|---|---|
| `session.start` | Session began |
| `assistant.turn_start` | Agent started a response turn |
| `assistant.turn_end` | Agent finished a response turn |
| `tool.execution_start` | Tool call started |
| `tool.execution_complete` | Tool call finished |
| `user.message` | User sent a message |

**Local session status derivation (sources 2 and 3):**

| Condition | Status |
|---|---|
| File mtime < 5 min old AND last event is `tool.execution_start` or `assistant.turn_start` with no matching `*_end` | `in_progress` |
| Last event is `assistant.turn_end` | `waiting` |
| No activity for > 30 min | `completed` |

**Implementation notes:**
- Use `fs.watch` on the relevant directories. Debounce 500 ms.
- Falls back gracefully if a path doesn't exist (user may not have the CLI or VS Code installed).
- The JSONL format is an unofficial internal format. All parsing must be wrapped in try/catch; parse failures log a warning and are skipped — never crash the app.

---

## Data Model

### `CopilotSession`

```ts
interface CopilotSession {
  id: string                        // session UUID (local CLI session or gh agent-task UUID)
  projectId: number | null          // null = unlinked (no matching repo rule)
  source: 'github' | 'cli' | 'vscode-chat'
  status: CopilotSessionStatus
  title: string                     // CLI summary, issue title, or workspace folder name
  htmlUrl: string | null            // URL to the issue/PR on github.com (github source only)
  startedAt: string                 // ISO 8601
  updatedAt: string                 // ISO 8601
  repoOwner: string | null          // resolved repo owner (for display + linking)
  repoName: string | null           // resolved repo name
  branch: string | null             // CLI source: branch from workspace.yaml
  linkedPrUrl: string | null        // github source: PR opened by Copilot
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
| `github` | The issue's repo → matched against `repo_rules` |
| `cli` | `workspace.yaml.repository` (`owner/name`) → matched against `repo_rules` |
| `vscode-chat` | `workspace.json.folder` → git remote of that path → `repo_rules` |

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
- Title (CLI summary, issue title, or workspace name)
- Source badge (`github` / `cli` / `vscode`)
- Branch (CLI source)
- "Started X ago" relative timestamp
- Link button to open the issue/PR in the browser (github source only)

---

## Out of Scope

- Writing back to GitHub (e.g. commenting on issues, requesting reviews) — read-only only
- Tracking Copilot code completions or inline suggestions
- Showing full Copilot session transcripts inline in the app
- Spawning, resuming, or controlling Copilot CLI sessions from this app
- Any cross-machine or cloud sync of local session state
