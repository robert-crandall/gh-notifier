# Copilot Instructions

## What This App Is

**GH Projects** is a personal project management tool for developers — specifically a solo developer managing multiple GitHub-heavy projects. It answers: "What am I working on and what do I need to do next?"

GitHub notifications are surfaced in the context of the **projects they belong to**. This is not a notification manager. Projects are the primary unit of the app.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron (macOS app bundle only) |
| Frontend | React (TypeScript) |
| Backend / main process | Node.js (Electron main process) |
| Database | SQLite (local, no server) |
| GitHub API | GitHub REST API v3 |

**macOS only.** No cross-platform compatibility work.

---

## Architecture Principles

These are non-negotiable constraints derived from the PRD:

1. **All I/O happens off the render thread.** GitHub API calls and SQLite writes belong in the Electron main process. The renderer never blocks on the network or disk.
2. **IPC is the bridge.** Renderer ↔ main communication uses Electron's `ipcRenderer` / `ipcMain`. Prefer typed IPC channels with a clear contract.
3. **Local-first.** The UI always renders from local SQLite state. Network results populate in place after the fact.
4. **No write-back to GitHub** except for unsubscribing from a notification thread.

---

## Project Structure (expected)

```
src/
  main/          # Electron main process: IPC handlers, GitHub sync, DB access
  renderer/      # React app
    components/
    hooks/
    pages/
  shared/        # Types and constants shared between main and renderer
db/              # SQLite schema and migrations
requirements/    # PRD and design docs (not shipped)
```

---

## Coding Conventions

- **TypeScript everywhere.** No plain JS files.
- **Functional React components only.** No class components.
- **Hooks for state.** Prefer lightweight state (React context or Zustand). Avoid Redux unless complexity demands it.
- **Strict null checks.** `strictNullChecks: true` in tsconfig.
- **No `any`.** Use `unknown` when the type is genuinely unknown, then narrow it.
- **Async/await over `.then()` chains.** All async code uses async/await.
- **Named exports preferred** over default exports (easier to grep and refactor).

---

## Preferred Libraries

| Purpose | Library |
|---|---|
| GitHub API client | `@octokit/rest` |
| SQLite | `better-sqlite3` |
| Schema/migrations | `drizzle-orm` or raw SQL migrations |
| Component styling | CSS Modules or a utility-first approach (no CSS-in-JS) |
| Date handling | `date-fns` |
| Testing | Vitest + React Testing Library |

If a library isn't listed here, check if an existing listed library covers the need before adding a new dependency.

---

## UI / UX Constraints

- Respect native macOS dark/light mode (`prefers-color-scheme`).
- The UI must feel **crafted**, not utilitarian. Visual quality is a feature.
- Never show a loading spinner that blocks interaction — async results update in-place.
- Snoozed projects are collapsed, not deleted or hidden entirely.

---

## Domain Model (quick reference)

- **Project** — primary unit. Has name, notes, next action, todo list, links, GitHub notifications, status (Active/Snoozed).
- **Inbox** — unmapped notifications that haven't been assigned to a project yet. First-class view.
- **Notification thread** — belongs to at most one project, or sits in the Inbox.
- **Routing rules** — thread-level mapping > repo-level rule > inbox (precedence order).
- **Filters** — suppress notifications globally. Multi-dimensional (author, org, repo, reason, state, type). AND logic. Two-tier type filtering: global (floor) + per-repo (additive only).
- **Snooze modes** — manual, date-based, notification-triggered.

---

## Out of Scope

Do not implement or suggest:
- GitHub write-back beyond unsubscribe
- Multi-user or team features
- Mobile or non-macOS targets
- Integrations beyond GitHub
- Gantt charts, sprints, velocity, or enterprise PM features
