# Engineering Roadmap: GitHub Task Manager

**Starting point:** UI prototype complete. All 5 screens built (Svelte + Tailwind). Rust backend fully stubbed (18 commands return hardcoded data). No persistence, no GitHub API, no async.

---

## Milestone 1: Local Persistence (SQLite)

**Goal:** Every action the user takes persists across app restarts.

### Tasks
- [ ] Add `rusqlite` (bundled) and `tokio` to Cargo.toml
- [ ] Create `db.rs` — initialize SQLite at the macOS app data directory
- [ ] Write schema migration (v1):
  - `projects` table (id, name, context_doc, next_action, status, snooze_mode, snooze_until, icon, repo_label, created_at, updated_at)
  - `notifications` table (id, github_id, repo_full_name, subject_title, subject_type, subject_url, reason, is_read, updated_at, project_id, author, author_avatar)
  - `manual_tasks` table (id, title, is_done, project_id)
  - `settings` table (key, value) — stores github_token, poll_interval, etc.
  - `thread_mappings` table (repo_full_name, thread_id, project_id) — for auto-routing
- [ ] Replace all 7 project commands with real CRUD queries
- [ ] Replace notification query commands (get, get_unmapped, mark_read, assign)
- [ ] Replace task commands with real queries
- [ ] Replace settings commands (get/save)
- [ ] Update frontend to remove try/catch fallback stubs (Tauri commands now work)

### Done when
- Create a project → restart app → project is still there
- Edit context doc / next action → persists
- All CRUD operations work end-to-end through the UI

---

## Milestone 2: GitHub Notification Sync

**Goal:** App pulls real notifications from GitHub and displays them.

### Tasks
- [ ] Add `reqwest` to Cargo.toml
- [ ] Create `github.rs` — GitHub REST API v3 client
- [ ] Implement `sync_notifications` command:
  - Call `GET /notifications` with the stored PAT
  - Upsert results into the notifications table
  - Filter out `team_mention` reason notifications automatically
  - Compute `unread_count` per project
- [ ] Implement token validation — test the PAT on save, show error if invalid
- [ ] Implement `unsubscribe_thread` — call `DELETE /notifications/threads/{id}/subscription`
- [ ] Implement "Open in GitHub" — resolve `subject.url` API URLs to browser-friendly HTML URLs
- [ ] Wire the Setup page to actually validate + save + do first sync

### Done when
- Enter a real GitHub PAT → app pulls your actual notifications
- Notifications appear in the Inbox
- Unsubscribe button actually unsubscribes on GitHub
- Invalid token shows an error message

---

## Milestone 3: Thread Mapping & Auto-Routing

**Goal:** Assigning a notification to a project teaches the app to auto-route future notifications from the same thread.

### Tasks
- [ ] When user assigns a notification to a project, save a mapping in `thread_mappings` (keyed by repo + thread ID)
- [ ] During sync, check incoming notifications against `thread_mappings` and auto-assign matches
- [ ] Show newly auto-routed notifications in the project detail view
- [ ] Update unread counts on the dashboard after sync
- [ ] Handle edge case: notification for a snoozed project (wake it if snooze_mode = "notification")

### Done when
- Assign notification from `org/repo#42` to "My Project"
- Next sync brings a new comment on `org/repo#42` → it auto-appears under "My Project"
- Inbox only shows truly unmapped notifications

---

## Milestone 4: Snooze System

**Goal:** User can hide projects and they resurface at the right time.

### Tasks
- [ ] Implement snooze UI (modal/popover with three mode options: date picker, "next notification", manual)
- [ ] `snooze_project` command → set status to "snoozed", save mode + until date
- [ ] `wake_project` command → set status back to "active", clear snooze fields
- [ ] On app startup, check date-based snoozes: if `snooze_until <= now`, auto-wake
- [ ] During notification sync, if a snoozed project (mode=notification) gets a new notification, auto-wake it
- [ ] Dashboard: snoozed section collapsed by default, shows resume criteria

### Done when
- Snooze a project until tomorrow → it disappears from Active → reappears tomorrow
- Snooze until "next notification" → new notification wakes it
- Manual snooze → only comes back when user clicks "Wake"

---

## Milestone 5: Background Polling

**Goal:** App stays current without manual sync button.

### Tasks
- [ ] Add Tauri async runtime setup for background tasks
- [ ] Create a polling loop that runs `sync_notifications` on a configurable interval (default: 5 min)
- [ ] Store poll interval in settings, respect changes without restart
- [ ] Show "last synced" timestamp in the UI (settings page or top bar)
- [ ] Handle errors gracefully (network down, token expired) — don't crash the loop
- [ ] Check date-based snoozes on each poll cycle (not just app startup)

### Done when
- Leave the app open → new notifications appear automatically
- Change poll interval in settings → takes effect immediately
- Network goes down → app shows stale data without crashing

---

## Milestone 6: Manual Tasks & Polish

**Goal:** Support non-GitHub tasks. Polish for daily-driver use.

### Tasks
- [ ] Manual task CRUD: create, toggle done, delete
- [ ] Attach manual tasks to projects (or keep standalone)
- [ ] Show manual tasks in project detail view alongside notifications
- [ ] Keyboard shortcuts: Cmd+N (new project), Cmd+K (search), Cmd+1/2/3 (nav)
- [ ] Empty states: no projects, no notifications, inbox zero
- [ ] Error handling: show user-friendly messages for API failures
- [ ] Loading states: skeleton screens during sync
- [ ] Window state persistence (size, position)

### Done when
- Can add "Call Bob about deployment" to a project
- App feels snappy and handles edge cases without confusion
- All success criteria from the PRD are met

---

## Post-MVP (Parking Lot)

These are explicitly **not** in the MVP. Revisit after validating the core workflow.

- Markdown rendering in context documents
- Notification sound/badge on macOS dock
- Multiple GitHub accounts
- Repo-level filtering (only watch specific repos)
- Drag-and-drop project reordering
- Data export/backup
- Auto-update mechanism (Tauri updater plugin)

---

## Code Quality & Testing Strategy

### Active Now
- **`cargo clippy`** (pedantic) — catches bugs, enforces idioms. Config in `src-tauri/.cargo/config.toml`. Run before commits.
- **`cargo fmt`** — consistent formatting. Config in `src-tauri/rustfmt.toml`.
- **`bun run check`** (`svelte-check`) — Svelte + TypeScript type checking. Run before commits.

**Pre-commit workflow:** `cd src-tauri && cargo clippy && cargo fmt --check && cd .. && bun run check`

### After M1 (Persistence)
- **Rust unit tests for `db.rs`** — test migrations, CRUD operations, edge cases (e.g., delete project with notifications, snooze null handling). This is the first code where bugs are subtle and painful.
- Use `#[cfg(test)]` module in each Rust source file.

### After M2 (GitHub Sync)
- **Rust unit tests for `github.rs`** — mock HTTP responses, test JSON parsing, test `team_mention` filtering logic. GitHub API responses are the most likely thing to break from upstream changes.

### After M3 (Auto-Routing)
- **Rust unit tests for thread mapping logic** — this is the "smartest" business logic. Test auto-assignment, re-routing, conflict handling.

### Not Planned for MVP
- **E2E tests** — UI is still evolving; too brittle to test through automation right now.
- **CI/CD** — solo dev, no PRs, no team. Manual checks before commits suffice.
- **ESLint/Prettier for Svelte** — nice-to-have; `svelte-check` already covers the critical path.

---

## Execution Notes

**Work in milestone order.** Each milestone builds on the previous one:
- M1 (persistence) is the foundation — nothing else works without it
- M2 (GitHub sync) is the core value proposition
- M3 (auto-routing) is what makes it "smart"
- M4 (snooze) is the ADHD-critical feature
- M5 (polling) makes it hands-off
- M6 (polish) makes it a daily driver

**Each milestone is independently shippable** — after M2 you have a usable (if manual) app. After M4 it's genuinely useful. M6 is the "1.0" quality bar.
