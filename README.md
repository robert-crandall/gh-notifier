# GH Projects

A personal project management tool for developers. Surfaces GitHub notifications in the context of the projects they belong to.

macOS only.

---

## Features

### Projects
The primary unit of the app. Each project has a name, notes, next action, todo list, labeled links, and a feed of routed GitHub notifications. The dashboard shows all active projects with their next action and unread notification count. Snoozed projects are visible in a collapsed section.

### GitHub Integration
- **Notification sync** — polls the GitHub Notifications API on a configurable interval, entirely off the render thread
- **Content prefetch** — thread details are fetched asynchronously after the notification list syncs; the UI renders immediately from local data
- **Thread closure** — when GitHub signals a thread is resolved (PR merged, issue closed), it disappears from view automatically — no acknowledgment step required
- **Unsubscribe** — calls the GitHub API to unsubscribe from a thread and closes it locally
- **Read state** — tracked locally; does not write back to GitHub

### Inbox and Routing
Notifications from unmapped threads land in the Inbox. From there you assign a thread to a project, creating a thread-level mapping. The app then offers to create a repo-level rule if a pattern is detected. Precedence: thread-level mapping → repo-level rule → inbox.

### Notification Filtering
Filters suppress notifications app-wide across multiple dimensions: author, org, repo, reason, state, and type. Multiple filters use AND logic. A two-tier type filter system lets you set a global floor (non-overridable) and per-repo additive rules on top of it.

### Snooze
Projects can be snoozed in three modes:
- **Manual** — hidden until you manually un-snooze
- **Date-based** — hidden until a specific date, then auto-surfaced
- **Notification-triggered** — hidden until a new GitHub notification arrives for the project

### Appearance
- Native macOS dark/light mode
- Multiple built-in themes
- Visually crafted UI — not a default Electron look

---

## Prerequisites

- [Bun](https://bun.sh) — the only supported package manager/runtime (`npm`/`node` are not required)
- Xcode Command Line Tools — required to compile `better-sqlite3` (`xcode-select --install`)
- A GitHub Personal Access Token — create one at https://github.com/settings/tokens/new with `notifications`, `repo`, and `read:user` scopes. The token is stored locally using Electron's safeStorage (OS-level encryption).

---

## Setup

```bash
# Install deps and rebuild better-sqlite3 for Electron's ABI
bun run setup
```

> `better-sqlite3` is a native module. It must be compiled against Electron's ABI, not Node's. Running plain `bun install` will fail — always use `bun run setup` on first clone or after changing the Electron version.

---

## Development

```bash
# Start Electron + Vite dev server with hot reload
bun run dev
```

---

## Build

```bash
# Compile all targets (main, preload, renderer) into out/
bun run build

# Package as a distributable .dmg
bun run dist
```

---

## Type checking

```bash
bun run typecheck
```

---

## Copilot MCP integration

GH Projects runs an inbound MCP server so the GitHub Copilot CLI can read project context and file human-gated todos (it never writes back to GitHub). The app registers itself in `~/.mcp.json` automatically, and a version-controlled skill teaches Copilot when and how to use the tools.

- Skill: [`.github/skills/gh-projects/SKILL.md`](.github/skills/gh-projects/SKILL.md)
- Wiring, enable/disable, and how to confirm it's up: [`docs/mcp-server.md`](docs/mcp-server.md)

---

## Resetting the notification sync cursor

If notifications go missing (e.g., after debugging or a sync race), clear the stored `since` timestamp so the next sync does a full re-fetch:

```bash
sqlite3 ~/Library/Application\ Support/gh-projects/gh-projects.db \
  "DELETE FROM sync_metadata WHERE key = 'last_notification_sync';"
```

The app must be closed (or will re-sync automatically on the next poll cycle) after running this.

---

## After updating Electron

If you bump the `electron` version in `package.json`, rebuild the native module:

```bash
bun run rebuild
```

---

## Project structure

```
src/
  main/          # Electron main process — IPC handlers, DB access, GitHub sync
  preload/       # Context bridge — exposes typed IPC to the renderer
  renderer/      # React app
    src/
      components/
      hooks/
      pages/
  shared/        # Types and constants shared between main and renderer
db/
  migrations/    # SQL migration files, applied in filename order on startup
docs/            # Operator/developer docs (e.g. the Copilot MCP integration)
requirements/    # PRD and milestone docs (not shipped)
.github/
  skills/        # Version-controlled Copilot skills (e.g. gh-projects)
```
