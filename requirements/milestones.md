# Milestones

Each milestone leaves the app in a stable, usable state. Later milestones build on earlier ones without requiring rewrites.

---

## M1 — Project Scaffold

**Goal:** A working Electron + React app that boots, nothing more.

- Electron shell with a single BrowserWindow
- Vite dev server with hot reload
- TypeScript configured (`strict`, `strictNullChecks`)
- SQLite wired up in the main process (`better-sqlite3`)
- IPC skeleton: typed channel definitions in `src/shared/ipc-channels.ts`
- Basic migration runner in `db/migrations/`
- `npm run dev`, `npm run build`, `npm run typecheck` all work

**Shippable signal:** App opens, shows a placeholder UI, no crashes.

---

## M2 — GitHub Authentication

**Goal:** User can connect their GitHub account and the app can make API calls.

- GitHub OAuth flow (main process handles the redirect)
- Token stored securely (macOS Keychain via `keytar` or equivalent)
- `@octokit/rest` client instantiated in main process, authenticated
- IPC channel to expose auth status to renderer
- Renderer shows "Connect GitHub" → "Connected as @user" state
- Token refresh / re-auth on expiry

**Shippable signal:** User can authenticate and the app reflects their identity.

---

## M3 — Core Project Management

**Goal:** The app is useful as a standalone project tracker, independent of GitHub.

- `projects` DB table + migrations
- CRUD IPC channels: `projects:create`, `projects:update`, `projects:delete`, `projects:list`
- Dashboard view: list of active projects, each showing name + next action
- Project detail view: name, notes, next action, links (labeled URLs), todo list
- Todo list: add, check off, reorder, delete tasks (`project_todos` table)
- Active / Snoozed status field (snooze logic comes in M6)
- Snoozed projects visible in a collapsed section (static for now)

**Shippable signal:** App is a functional project tracker. GitHub features not yet needed.

---

## M4 — Notification Sync and Routing

**Goal:** GitHub notifications appear in the right project.

- Poll GitHub Notifications API on a configurable interval (main process, fully async)
- `notification_threads` and `repo_rules` DB tables
- Notifications stored locally; UI renders from local state only
- Thread-level mapping: thread → project
- Repo-level rules: repo → project (lower precedence than thread mapping)
- Inbox view: unmapped notifications
- Assign-to-project flow from Inbox
- Post-assignment repo rule offer (opt-in / opt-out / no offer logic from PRD)
- Repo rules editable/deletable in Settings
- Unread count badge on each project in the dashboard

**Shippable signal:** Notifications arrive, route to projects, Inbox captures the rest.

---

## M5 — Thread Lifecycle and Unsubscribe

**Goal:** Closed work disappears automatically; manual unsubscribe works.

- Async content prefetch: after notification list syncs, fetch thread details in background; content populates in-place
- Content staleness: re-fetch only when a new notification arrives on the thread
- Thread closure: auto-remove threads when GitHub signals PR merged / issue closed
- Read state: tracked locally, no write-back to GitHub
- Unsubscribe: IPC channel calls GitHub API, removes thread locally

**Shippable signal:** Merged PRs and closed issues vanish without user action. Unsubscribe works.

---

## M6 — Snooze

**Goal:** Projects can be silenced until they matter again.

- Three snooze modes: manual, date-based, notification-triggered
- `snooze_until` and `snooze_mode` fields on `projects` table
- Background job in main process wakes date-based snoozes
- Notification-triggered snooze: un-snooze fires when a new notification routes to that project
- Snoozed projects collapsed on dashboard (was static in M3, now functional)

**Shippable signal:** Snooze works in all three modes end-to-end.

---

## M7 — Notification Filtering

**Goal:** Noise is suppressible at multiple dimensions with a clear hierarchy.

- `filters` DB table (author, org, repo, reason, state, type)
- Filter evaluation runs in main process before storing/displaying notifications
- Two-tier type filtering: global floor + per-repo additive rules
- Renderer: filter management UI with removable chips
- UI makes global vs. per-repo hierarchy visually explicit

> **Note:** PRD specifies filters are session-scoped in v1. Persist to DB now anyway — session-only is a regression risk and the cost is negligible.

**Shippable signal:** Filtering works across all dimensions; global type floor cannot be overridden per-repo.

---

## M8 — Appearance and Polish

**Goal:** The app feels crafted, not like a default Electron shell.

- Native macOS dark/light mode (`prefers-color-scheme`)
- At least two built-in themes beyond light/dark
- Theme switcher in Settings
- Typography, spacing, and color pass — no default browser/Electron styling visible
- App icon, window chrome appropriate for macOS
- No layout jank or flash of unstyled content on launch

**Shippable signal:** All 10 success criteria from the PRD are met. App is ready to use daily.
