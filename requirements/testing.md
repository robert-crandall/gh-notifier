# Testing Requirements

## Philosophy

Tests are a CI gate — every test in this file must pass before a PR can merge. The test suite is therefore kept **lean and high-confidence**: test the logic that is hardest to debug manually, skip what adds noise without reducing risk.

Because this is an Electron app with a SQLite database and a React renderer, the test surface splits cleanly into three layers: pure-logic unit tests, database integration tests, and React component tests. End-to-end Electron tests are **out of scope** for the CI gate (see below).

---

## Tooling

| Purpose | Tool |
|---|---|
| Test runner | Vitest |
| Component testing | React Testing Library |
| IPC mocking | `vi.mock` stubs for `window.electron` |
| DB testing | `better-sqlite3` with an in-memory database (`:memory:`) |
| Type checking | `tsc --noEmit` (run as part of CI) |
| Linting | ESLint with `@typescript-eslint` + `eslint-plugin-react-hooks` |

No additional test libraries should be introduced without updating this document.

---

## CI Requirements

The following must pass on every PR before merge:

1. `bun run typecheck` — zero TypeScript errors, strict mode
2. `bun run lint` — zero ESLint errors
3. `bun test` — all unit and integration tests pass
4. No `any` types introduced (enforced by `noImplicitAny` in tsconfig)

---

## Layer 1 — Unit Tests (Pure Logic)

These tests have no I/O dependencies. They run in milliseconds and must cover all non-trivial branching logic.

### `src/main/db/filters.ts` — Filter matching

`filterMatches(filter, thread)` and `shouldSuppress(thread, filters)` are pure functions with well-defined inputs. Full branch coverage is required.

**`filterMatches` cases:**

| Dimension | Test case |
|---|---|
| `author` | Substring match in thread title (case-insensitive) |
| `author` | No match when substring is absent |
| `org` | Matches repo_owner containing the org string |
| `org` | No match on different org |
| `repo` | Matches repo_name substring (case-insensitive) |
| `repo` | No match on different repo |
| `reason` | Exact match (case-insensitive) |
| `reason` | No match on different reason |
| `state` | Matches `subject_state` (open / closed / merged) |
| `state` | No match when state differs |
| `type` | Exact match against thread type (PullRequest, Issue, etc.) |
| `type` | No match on different type |

**`shouldSuppress` cases:**

| Scenario | Expected |
|---|---|
| Single global filter matches | suppress = true |
| Single global filter does not match | suppress = false |
| Multiple filters — any one matches | suppress = true (OR logic across filters) |
| Repo-scoped type filter matches repo + type | suppress = true |
| Repo-scoped type filter matches type but wrong repo | suppress = false |
| Empty filter list | suppress = false |

### `src/main/db/projects.ts` — Row mappers

The functions that convert snake_case DB rows to camelCase domain models must be tested in isolation. Verify all fields are mapped correctly and that nullable fields (e.g., `snooze_until`, `notes`) map to `null` / `undefined` rather than `""` or `"null"`.

### `src/main/db/notifications.ts` — Row mappers

Same requirement as projects: row mapper functions must be tested for correct field naming, type coercion (e.g., `unread` integer → boolean), and nullable fields.

### `src/renderer/src/hooks/useTheme.ts`

- Saved theme is read from `localStorage` on mount and applied as `data-theme`
- System `prefers-color-scheme: dark` is used when no saved theme exists
- `setTheme()` persists to `localStorage` and updates `data-theme`
- Calling `setTheme()` with an invalid theme name does not update state

---

## Layer 2 — Database Integration Tests

These tests run the actual migration stack against an in-memory `better-sqlite3` database. They must not hit the filesystem or network.

**Setup:** Each test file (or suite) should run all migrations from `db/migrations/` against a fresh `:memory:` database before running assertions.

### `src/main/db/migrate.ts`

- All migrations apply without error in order
- Re-running migrations is idempotent (no duplicate-column errors)
- `_migrations` table is populated with applied file names

### `src/main/db/projects.ts`

| Operation | Assertions |
|---|---|
| `createProject(name)` | Returns a project with the given name; `status` defaults to `'active'`; `sort_order` auto-increments |
| `listProjects()` | Returns projects ordered by `sort_order`; includes correct `unreadCount` from joined threads |
| `getProject(id)` | Returns `ProjectDetail` with `todos` and `links` arrays |
| `updateProject(id, { name })` | Name is updated; `updated_at` changes |
| `updateProject(id, { status: 'active' })` | Clears `snooze_until` and `snooze_mode` |
| `deleteProject(id)` | Project is removed; associated todos and links are CASCADE deleted |
| `snoozeProject(id, 'manual')` | Sets `status = 'snoozed'`, `snooze_mode = 'manual'`, `snooze_until = null` |
| `snoozeProject(id, 'date', isoString)` | Sets `snooze_until` to the provided date |
| `snoozeProject(id, 'date')` (missing until) | Throws or returns an error |
| `wakeExpiredSnoozes()` | Projects with `snooze_mode = 'date'` and `snooze_until` in the past are set to `'active'`; future-snoozed projects are untouched; notification-triggered and manual snoozes are not woken by this function |

### `src/main/db/notifications.ts`

| Operation | Assertions |
|---|---|
| `upsertThreads([])` | No-op; returns cleanly |
| `upsertThreads(threads)` — new threads | Threads appear in DB; threads matching a repo rule are assigned to that project |
| `upsertThreads(threads)` — existing thread updated | `updated_at` and `unread` are updated; `project_id` is not overwritten if already assigned |
| `listThreadsByProject(projectId)` | Returns only threads for that project; suppressed threads (matching active filters) are excluded |
| `listInboxThreads()` | Returns only threads with `project_id IS NULL`; suppressed threads excluded |
| `getUnreadCounts()` | Returns correct count per project; projects with no unread threads return 0 or are absent |
| `assignThread(threadId, projectId)` | Sets `project_id` on the thread; returns a `RepoRuleSuggestion` if other unassigned threads exist from the same repo |
| `assignThread(threadId, null)` | Moves thread back to inbox |
| `markThreadRead(threadId)` | Sets `unread = 0` locally |
| `deleteThread(threadId)` | Thread is removed from DB |
| `getThreadsNeedingPrefetch()` | Returns threads where `content_fetched_at IS NULL` or `updated_at > content_fetched_at` |
| `updateThreadContent(threadId, state, htmlUrl)` | Sets `subject_state`, `html_url`, `content_fetched_at` |
| `invalidateOpenThreadPrefetch()` | Resets `content_fetched_at` for threads with `subject_state = 'open'` or `subject_state IS NULL` |
| Snooze wake on new notification | Inserting a thread for a project that is `snooze_mode = 'notification'` sets that project to `'active'` |

### `src/main/db/filters.ts`

| Operation | Assertions |
|---|---|
| `createFilter('author', 'bot', 'global')` | Filter stored and retrievable via `listFilters()` |
| `createFilter('type', 'PullRequest', 'repo', 'owner', 'repo')` | Stored with correct scope fields |
| `createFilter('author', 'bot', 'repo', 'owner', 'repo')` | Rejected — repo scope is only valid for `type` dimension |
| `createFilter('type', 'Issue', 'global')` | Accepted — global scope for type is valid |
| `deleteFilter(id)` | Filter removed; no longer returned by `listFilters()` |

---

## Layer 3 — React Component Tests

These tests use React Testing Library with all `window.electron` IPC calls mocked. They verify rendered output and user interaction — not internal implementation details.

### `AuthPanel`

| Scenario | Assertion |
|---|---|
| Unauthenticated state | PAT input and "Connect" button are rendered |
| Submitting empty PAT | Form does not call `ipc.invoke('auth:save-token')` |
| Authenticated state | Avatar image, login name, and "Sign out" button are rendered; PAT form is not shown |
| "Sign out" clicked | `ipc.invoke('auth:logout')` is called |

### `FilterSection`

| Scenario | Assertion |
|---|---|
| Initial render | Active filters are listed; "Add filter" form is present |
| Selecting dimension `author`/`org`/`repo`/`reason` | Text input is shown for the value field |
| Selecting dimension `state` | Select dropdown with valid states is shown |
| Selecting dimension `type` | Select dropdown with notification types is shown |
| Selecting repo scope | Owner and repo name fields appear |
| Submitting repo-scoped filter with blank owner or repo | Submit is blocked; error message is shown |
| Valid filter submission | `ipc.invoke('filters:create', ...)` is called with correct args |
| Clicking × on a filter chip | `ipc.invoke('filters:delete', id)` is called |

### `Dashboard`

| Scenario | Assertion |
|---|---|
| No projects | Empty state message is rendered |
| One active project with `nextAction` set | Focus banner is rendered with that project's name |
| Multiple active projects | All are rendered in sort order |
| Snoozed projects | Appear in the snoozed section, not the active list |
| "New project" form | Clicking the add button shows the inline input; submitting calls `ipc.invoke('projects:create', name)` |

### `Inbox`

| Scenario | Assertion |
|---|---|
| Not authenticated | "Add token in Settings" prompt is shown instead of thread list |
| Threads present | Each thread's title and repo are rendered |
| Sync button clicked | `ipc.invoke('notifications:sync')` is called |
| Assign dropdown selection | `ipc.invoke('notifications:assign', threadId, projectId)` is called |
| Repo rule suggestion shown | "Apply rule for this repo?" banner is displayed when `assign` returns a suggestion |

---

## Linting

Linting is intentionally minimal. TypeScript strict mode handles type safety. ESLint covers only the rules that TypeScript cannot catch.

**Required rules (errors, not warnings):**

| Rule | Why |
|---|---|
| `react-hooks/rules-of-hooks` | Calling hooks conditionally or inside loops is a silent runtime bug |
| `react-hooks/exhaustive-deps` | Missing `useEffect` / `useCallback` deps cause stale-closure bugs |
| `@typescript-eslint/no-explicit-any` | Reinforces the no-`any` constraint at lint time, not just type-check time |
| `@typescript-eslint/no-unused-vars` | Catches dead code the compiler misses in some configurations |

**Explicitly not enabled:**
- Style / formatting rules (no Prettier, no `max-len`) — not a team project, not worth the noise
- Import ordering rules
- Complexity / cognitive-complexity rules

Configuration lives in `eslint.config.mjs` (flat config format). Run with `bun run lint`.

---

## Out of Scope (Do Not Add to CI Gate)

| Item | Reason |
|---|---|
| End-to-end Electron tests | Require packaging and OS-level automation; too slow and fragile for a PR gate |
| Visual regression / screenshot tests | No agreed design baseline to diff against |
| GitHub API integration tests | Network-dependent; mocked at the Octokit boundary instead |
| `safeStorage` / Keychain tests | macOS-only native API; cannot run in headless CI without a signed app |
| Performance / load tests | Not a current risk surface |
| Migration rollback tests | No rollback mechanism exists |
