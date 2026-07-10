---
name: gh-projects
description: >-
  Use when working inside the GH Projects app's world - re-entering a project,
  triaging GitHub notifications, reviewing a PR you were asked to follow up on,
  or planning/recording a service rollout - and the GH Projects MCP tools
  (ping, add_todo, list_projects, get_project_context, get_reentry_digest,
  read_service_knowledge, write_service_knowledge) are available. Teaches when to
  orient with the read tools before acting, how to propose human-gated follow-up
  work with add_todo instead of writing to GitHub, and how to read/record service
  runbooks. Do NOT trigger this for unrelated coding sessions.
---

# GH Projects MCP tools

GH Projects is a personal, macOS project-management app. It exposes an **inbound MCP
server** so you (Copilot) can read the app's own situational state and file
human-gated follow-up work. These tools let you act *with the project's context*
instead of guessing.

## The one rule that matters most

**These tools never write to GitHub.** The only way you affect the outside world is
by proposing work the human approves later. When you finish reviewing a PR or spot
something worth doing, call `add_todo` to file a proposal in GH Projects - do **not**
post a comment, request changes, or push anything to GitHub through these tools.

Exception: if the user explicitly asked you to leave a real PR review comment using
some *other* tool, honor that. `add_todo` is for follow-up work inside GH Projects,
not a replacement for a review comment the user directly requested.

## When to reach for these tools

Trigger on GH-Projects-shaped work, not every session:

- **Re-entering / orienting** - "what was I doing", "what changed", "what should I
  pick up". Start with `get_reentry_digest` (and `list_projects` for the roster).
- **Before proposing a fix or a rollout plan** - pull `get_project_context` for the
  project, and `read_service_knowledge` for any service you'll touch, *first*. Don't
  propose against a blank slate.
- **After reviewing a PR** - file the follow-up as a todo with `add_todo`.
- **After learning something durable about a service** (health check, monitor, a
  gotcha) - record it with `write_service_knowledge`.

Do not call these during unrelated coding work. `get_reentry_digest` / `list_projects`
are for GH-Projects orientation, not a generic "what's going on" probe.

## Core workflows

### 1. Orient at the start of a GH Projects session
```
get_reentry_digest            # {projects:[...]} - what changed / what to pick up
list_projects                 # the roster: id, name, status, next action, open-todo count
```
`get_reentry_digest` with no `project` returns every project with new activity or
drift. Pass a `project` to focus on one.

### 2. Get context before you propose anything
```
get_project_context { "project": "Payments revamp" }
```
Returns the project card (purpose, repos, **services**, active goal, glossary), open
todos, links, and saved resources. Use the `services` list to learn the exact service
slugs, then:
```
read_service_knowledge { "service": "payments-api", "includeResources": true }
```
Now propose your fix/rollout grounded in the runbook and the real linked resources.

### 3. After reviewing a PR, propose - don't comment
```
add_todo {
  "repo": "acme/payments-api",
  "title": "Address review feedback on PR #482",
  "body": "Nullable receipt id needs a guard; suggest adding a test for the empty-cart path.",
  "sourceUrl": "https://github.com/acme/payments-api/pull/482",
  "suggestedAction": {
    "kind": "pr_comment",
    "url": "https://github.com/acme/payments-api/pull/482",
    "comment": "Consider guarding the nullable receipt id before dereferencing."
  }
}
```
The `suggestedAction` is advisory - the app renders a one-tap affordance but never
performs the GitHub write for you. The human decides.

### 4. Record what you learned about a service
```
read_service_knowledge { "service": "payments-api" }    # read current runbook first
write_service_knowledge {
  "service": "payments-api",
  "markdown": "# payments-api\n\n## Health\nHit the **Payments health dashboard** ...\n\n## Gotchas\n..."
}
```
Read before you write. Only record durable, operational, user-relevant knowledge -
health checks, monitor links, on-call notes, gotchas. **Never write secrets.** Prefer
referencing a saved resource by its **name/alias** (from `get_project_context` or
`read_service_knowledge` with `includeResources: true`) rather than pasting a raw URL
that will rot. The write is **immediate and ungated** (no approval step), but the
prior version is backed up before every overwrite, so it's recoverable.

## Idempotency: don't create duplicates

`add_todo` de-duplicates on a key derived from the **normalized `sourceUrl` plus the
full `suggestedAction`**:

- Same `sourceUrl` **and** same `suggestedAction` → **updates** the existing todo in place.
- Same `sourceUrl` but a **different** `suggestedAction` → a **distinct** new todo.
- **No `sourceUrl`** → always inserts a new todo (nothing stable to dedup on).

So when you re-review the same PR, pass the same `sourceUrl` (and keep the action
stable) to update rather than pile up duplicates. Always include a `sourceUrl` when
one exists.

## Placement: where a todo lands

`add_todo` resolves placement in this order:

1. Explicit `project` (exact project **name**) wins.
2. Else `repo` (`"owner/name"`) is routed to a project via the same rules notifications use.
3. Else it lands in the **Inbox**.

## Project argument cheat sheet (easy to get wrong)

| Tool | `project` accepts |
|---|---|
| `add_todo` | exact project **name string only** (never an id) |
| `get_project_context` | name **string** OR integer **id** (required) |
| `get_reentry_digest` | name **string** OR integer **id** (optional) |
| `read_service_knowledge` | exact project **name string only** (optional; scopes linked resources) |

Get names/ids from `list_projects`. Don't pass a numeric id to `add_todo.project` or
`read_service_knowledge.project` - those are name-only.

## Tool reference

| Tool | Required | Optional | What it does |
|---|---|---|---|
| `ping` | - | - | Liveness check. Returns `pong`. Use to confirm the server is reachable. |
| `add_todo` | `title` | `project`, `repo`, `body`, `sourceUrl`, `suggestedAction` | Files a human-gated todo (a proposal). Never writes to GitHub. |
| `list_projects` | - | - | Read-only roster: `id`, `name`, `status` (active/snoozed), `nextAction`, `activeTodoCount`. |
| `get_project_context` | `project` | - | Read-only brief: card, open todos, links, resources, service names. |
| `get_reentry_digest` | - | `project` | Read-only "what changed while I was away" digest. Always `{ projects: [...] }`. |
| `read_service_knowledge` | `service` | `includeResources`, `project` | Reads a service's markdown runbook fresh from disk. Friendly note (not an error) when none exists. |
| `write_service_knowledge` | `service`, `markdown` | - | Creates/overwrites a service runbook (ungated, backed up). |

`suggestedAction` (all optional, advisory only) is one of:

- `{ "kind": "pr_comment", "url": "...", "comment": "..." }`
- `{ "kind": "delegate", "prompt": "..." }`
- `{ "kind": "open_url", "url": "..." }`

A `service` is a slug like `payments-api` (lowercase letters/digits with `-`, `_`, `.`).
`sourceUrl` and any action `url` must be `http`/`https`.

## When the app isn't running

If GH Projects isn't running, every tool **call** - `add_todo`, the read tools, and
even `ping` - returns a clean **"The GH Projects app isn't running..."** error (they
never hang). Only the tool **list** stays available (the shim serves it statically), so
you'll still see the tools advertised even when the app is down; calling any of them
just reports the app isn't running. If you hit that error, tell the user to start GH
Projects and retry - don't fall back to writing on GitHub directly.
