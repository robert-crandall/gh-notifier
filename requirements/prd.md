# Product Requirements Document: Focus (working title)

> Rebuild of "GH Projects." The v1 PRD is preserved at `prd-v1-archive.md`.
> Working title only - naming genuinely doesn't matter yet (candidates: Focus, Throughline, Workbench). Pick later.

**Target user:** Solo developer with ADHD, running several personal projects with heavy GitHub + Copilot involvement.
**Platform:** macOS desktop (Electron + React + TypeScript + SQLite).

---

## Read this first (the whole thing in 9 bullets)

- The old app was a **project-centric notification manager**. That framing quietly fights how I think.
- The real problem isn't missed notifications. It's **losing the thread** - I hyperfocus, drop a thing thinking "back in 2h," lose days, and shame makes re-entry hard.
- A dashboard of *N projects with counts* is the exact "6 unrelated items" surface that de-motivates me.
- So the rebuild does three ADHD-native jobs: **hold one thing** · **re-orient me on return** · **absorb the tedious finish**.
- The home is **one project in focus**, not a grid. Everything else is one keystroke away.
- On open, a **"since you were last here"** digest catches me up - blame-free, no streaks, no time-shaming.
- **Copilot is the spine, not a status dot.** Delegate work and walk away - to the installed Copilot desktop app when it's running (cloud `gh agent-task` as the fallback) - and ask the project brain fast, read-only questions via the installed Copilot CLI. Focus *drives* installed Copilot; it doesn't bundle one.
- Projects accumulate **hundreds** of dashboards, queries, and docs. I won't remember them and I won't curate bookmarks - so the agent holds a per-project **context brain** and I retrieve by *asking* ("how's the service mesh latency?"), not by navigating a list.
- Notifications, inbox, routing, filters all still exist - demoted to *supporting inputs* behind a quick-switcher.

---

## Why rebuild (the reframe)

The v1 problem statement: "what am I working on and what do I do next?" - answered with a project dashboard + a GitHub notification router.

Held against my *ADHD Profile* and *Cognitive Interface Model*, three things are wrong at the *problem* layer, not the feature layer:

| v1 assumption | What my profiles actually say | Implication |
|---|---|---|
| A dashboard of all projects orients me | "Avoid surfaces like 'you have 6 pending items across 6 areas' - actively de-motivating." Uncoupled complexity is shallow + irritating. | Default to **one** focus. Others behind a switcher, not a competing grid. |
| The job is routing notifications | The job is not losing the thread. Time blindness turns "back in 2h" into 3 days; I over-trust recall. | The app is **insurance for my context** + **re-entry**, not a firehose. |
| Nothing addresses finishing | My hardest part is the last 10% (tests, review nits, lint, docs). Boredom (not difficulty) ends tasks. | Hand the tedious finish to **Copilot**. That's the point of the integration. |
| A PM tool is inherently helpful | Meta-work watch item: building trackers can *become* the avoidance task. | **Zero grooming.** Auto-capture, auto-route, auto-close. If it needs upkeep, it fails. |

---

## Design principles (derived from the profiles, not invented)

- **One primary thing.** Calm surface, vim-not-Bloomberg. The focus fills the screen; the rest is a keystroke away.
- **Protect against tedium, not difficulty.** Keep easy paths instant. Never add hand-holding to routine flows. Let hard things stay hard.
- **External state is insurance.** Persist my working context automatically; never rely on my recall.
- **Capture without hand-filing; let the machine hold the structure - but keep decay visible.** Never make me build or groom a taxonomy of tags/folders. I dump; the agent enriches, files, and groups; I interact by asking. But the brain has a half-life - so surface staleness *in context when it's relevant* (a failed lookup, a broken link) rather than pretending the system self-heals or handing me a chore list.
- **Re-orient on return.** Actively catch me up ("here's where you were, here's what changed"), don't silently restore and leave me to reconstruct.
- **Blame-free re-entry.** No streaks, no "you haven't touched this in 12 days," no guilt. Stale work waits quietly and greets me warmly.
- **Undo over confirmation.** Recoverable by design (soft-delete everywhere). Reserve hard confirms for the genuinely unrecoverable.
- **Verdict + tradeoffs.** Surfaces that decide (routing, "what next") lead with a recommendation, with the trade space underneath.
- **Vanilla defaults, all overridable.** Standard choices as a relief; every default visible and changeable.
- **Explicit-but-terse success; verbose failure.** A checkmark when it worked; full diagnostics when it broke. Instant signal.
- **Scannable by default.** Bullets, short chunks, strong headings. Never gate comprehension behind a wall of prose.
- **Click-first, shortcuts as reward.** Mouse-friendly discovery; hotkeys accelerate once fluent; nothing core gated behind a chord.
- **Automate anything done twice.** Repeated workflows are scriptable (routing rules, agent launch templates, snooze).

---

## The shape of the app

```
┌──────────────────────────────────────────────────────────────┐
│  ⌘K quick-switcher (projects · inbox · settings · new)        │
├───────────────┬──────────────────────────────────────────────┤
│               │  SINCE YOU WERE HERE                          │
│  Focus rail   │  • Copilot finished 2 turns on #142           │
│  (thin,       │  • PR #131 is now ready to review             │
│  collapsible) │  • 3 new notifications routed here            │
│               ├──────────────────────────────────────────────┤
│  ● project A  │  NEXT ACTION                                  │
│  ○ project B  │  Wire the retry backoff into the sync loop    │
│  ○ project C  │  [ Hand to Copilot ]  [ Edit ]  [ Done ]      │
│               ├───────────────┬──────────────────────────────┤
│  inbox (2)    │  Todos/Notes  │  Copilot (delegated)          │
│               │  Resources ⌕  │  session link · live status   │
│               │  Notifications│  ask the brain (read-only)    │
└───────────────┴───────────────┴──────────────────────────────┘
```

- **Focus rail (left, thin):** the projects list as *landmarks*, not a dashboard. One is in focus at a time. Small status dot per project (agent working / needs you / quiet). Inbox pinned at the bottom. Collapsible so the focus can go full-bleed.
- **Re-entry digest (top of focus):** the signature feature. See below.
- **Next action (center):** one line, big, editable inline. Primary button: **Hand to Copilot**. Secondary: Edit, Done.
- **Working column:** Todos · Notes (scratch) · **Resources** (ask-first, see below) · Notifications for this project, as tabs. Progressive disclosure - operating shows the whole territory, but only for the *one* focus.
- **Copilot panel (right):** the delegated-session view for this project - a link to the session running in the installed Copilot app plus its live status, and a read-only ask-the-brain box (details below).
- **⌘K quick-switcher:** everything not the focus - jump projects, open inbox, settings, new project, launch a task. Keeps the surface calm while making the whole territory a keystroke away.

Nothing here forces me to hold several unrelated projects in my head at once. The focus is deep and coupled; the rest is a landmark I navigate to.

---

## Core concepts

### Project (unchanged in essence, re-centered)
Container for one body of work: name, notes (freeform scratch), next action, todo list, a **project context brain + resource corpus** (see below), routed notifications, and **agent sessions**. Status: active / snoozed. Exactly one project is *in focus* at a time.

### Project Context & Resources (the "project brain")
Replaces the flat links list, and it's arguably the strongest reason to rebuild. **The load-bearing piece is the resolver, not a markdown doc** - "put my notes in the agent's context" would just be a fancy notes field. Three parts:

- **Project card (tiny, always in context).** A short, structured brief per project: purpose, repos, services, active goal, key aliases/glossary. This is the *only* thing injected into the agent every turn. Small and stable - it changes rarely. Its fields are **suggested/updated as a byproduct of use** (the agent proposes an alias or a shifted "active goal" from what I actually ask and what resolves), so it doesn't quietly become its own manual-upkeep chore.
- **Resource registry (typed, retrieved on demand).** Each dashboard / saved query / doc / repo / link is a typed record, not a bookmark:
  `{ title, kind, url-or-query, service/system, env, aliases[], description, provenance, confidence, last_used, last_verified, failure_count }`.
  Hundreds of these are fine because they are **never all injected** - the resolver pulls only the top matches for a given question.
- **Resolver.** Maps fuzzy language → the right record(s). "Service mesh latency" → the mesh-latency Datadog dashboard for *this* service/env. It returns a scored, **cited** answer, runs the source via a wired MCP tool when possible, and says **"no source saved for that"** instead of guessing. **On low confidence or a near-tie it asks a one-line clarifying question or shows the top candidates - a cited-but-wrong answer is worse than "not sure, is it X or Y?"** Suspect / low-confidence records are **down-ranked, not just labeled**. This is the part I have to get right; it is where prior attempts failed.

Interaction model (this is the whole point):

- **Retrieve by question, not navigation.** I ask in English; the resolver picks the source (with a citation I can inspect), runs it via the wired MCP tool (Datadog / Splunk / Kusto) when one exists, and answers with the live value + link. "How's the service mesh latency?" → "p99 240ms, +15% d/d - [dashboard]," not "here's your bookmark." No confident answer without a cited source.
- **Capture as a byproduct of use.** Paste/drop a URL → the agent proposes a typed record (title, service, description) for one-click accept (undoable). Save a query straight from chat. I never hand-file into folders.
- **Maintenance as a byproduct of use, not a chore.** Every record carries `last_used` / `last_verified` / `confidence` / `failure_count`. When a retrieval fails or a link/query breaks, the record is marked *suspect* automatically. Stale records surface **only when they're relevant to what I'm asking**, never as a to-do list of chores. The agent may propose corrections; semantic rewrites of important mappings need my one-tap approval. (Honest about the profile's "every system has a half-life" - the brain decays; the design makes decay visible in-context instead of pretending it's self-healing.)
- **Browse an auto-derived hierarchy.** When I want the visual/spatial map, resources are grouped (by tool / service / derived topic). Grouping is **computed, not maintained**. Overrides (pin/rename a group) are rare and visible - so tags don't quietly become grooming.

**Verdict on the user's hierarchy vs. tags question:** neither, as a thing I maintain. The primary interface is the *question* answered by the resolver; structure is agent-derived and powers browsing only. This resolves the profile tension (I love hierarchy, but I can't sustain grooming) by putting the machine in charge of structure - but with honest decay signals rather than a false "self-maintaining" promise.

### Focus
The single project currently front-and-center. Switching focus is cheap (⌘K or click a rail item) and recomputes the re-entry digest for the newly-focused project.

### Re-entry digest ("Since you were here")
A computed, blame-free catch-up shown at the top of a focus when I return after being away. Sources:
- Agent turns completed / awaiting my input / PRs opened or merged.
- Notifications that routed here since last seen.
- Todos the agent checked off; files it changed.
- Never phrased as time-shame ("gone 3 days"). Phrased as orientation ("here's what moved").
Dismissible; regenerates from a per-project `last_seen_at` watermark.

### Parked vs. forgotten (peripheral memory)
Single-focus has a real failure mode for a time-blind person: out of sight, out of mind. The re-entry digest catches me up on the *focused* project, but something has to keep the *unfocused* ones from silently rotting. So the app distinguishes two states and never conflates them:

- **Parked (intentional):** I snoozed it, or set it aside on purpose. Quiet. Resurfaces on its own terms (date / notification / manual).
- **Drifting (accidental):** an active project I simply haven't returned to. The app *knows* the difference via last-touched + whether I ever chose to park it.

Resurfacing rules (blame-free, no counts, no streaks):
- Rail landmarks show **quiet status** (a dot: agent working / needs you / drifting), not unread counts.
- A gentle, periodic **"threads you left open"** review surfaces drifting projects - framed as orientation ("still want this warm?"), never guilt.
- **Suppression is explicit:** each surfaced thread has one-tap park / snooze / "not now," and there's a frequency cap so resurfacing can never become a nag. Parking something moves it from drifting → parked (intentional).
- Resurfacing does **not** depend on me remembering to open ⌘K. The app brings a drifting thread back into view on its own.

This is the deliberate answer to "won't single-focus make me forget everything else?" - the machine holds the periphery so I don't have to.

### Agent session (the Copilot spine)
A unit of Copilot work attached to a project. Focus **drives installed Copilot** rather than embedding one - two delegate paths, **one session model**:

1. **Delegate to the installed Copilot desktop app (preferred)**
   - Over the app's local WebSocket: `create_session` (cwd = the project's local checkout) → `send_message`. Focus stores the returned session id.
   - The app runs it locally; Focus shows a link to that session plus its live status (working / needs you / done).
   - This is the app's **unofficial** internal protocol, so it's isolated behind one adapter (`src/main/agent/copilot-app/`) with the cloud path as the resilient fallback. Requires the app to be running and, for local delegation, a checkout of the repo on disk.

2. **Cloud agent task (fallback / walk-away)**
   - The existing `gh agent-task` path. Used when the desktop app isn't running (or no local checkout resolves), and for pure delegate-and-leave work.
   - Surfaces back through the re-entry digest and the rail status dot when it's done or needs me.

Both are session rows with one **user-facing status** — working / needs you / done (+ error). Underneath, the cloud path also passes through GitHub's own `pr_ready`/`completed` states, which map onto that same shape. Focus is **read-only toward both**: it launches/opens sessions and reads their status; it never steers them turn-by-turn.

### Inbox / routing / filters (demoted, not deleted)
Unmapped notifications land in the Inbox (behind ⌘K, not on the home). Routing precedence unchanged: thread mapping > repo rule > inbox. Filters (author/org/repo/reason/state/type, AND logic, global floor + per-repo additive) unchanged. These are *inputs* that feed the digest and can spawn agent work - not the main surface.

---

## Features

### 1. Focus & navigation
- Home opens to the last-focused project (or a gentle empty state if none).
- Focus rail lists projects as landmarks with a status dot; inbox pinned at bottom; collapsible.
- ⌘K quick-switcher: fuzzy jump to any project, inbox, settings; create project; launch a task. Click-first; the shortcut is the reward.
- Switching focus recomputes the re-entry digest.

### 2. Re-entry digest
- Auto-computed on focus open from the `last_seen_at` watermark.
- Groups: agent activity · PR/issue state changes · new notifications · todos closed by agents.
- Blame-free copy; scannable bullets; one-click to the relevant thing (open PR, open agent panel, view notification).
- Dismiss updates the watermark. Fully recoverable (watermark is data, resettable).

### 3. Project management
- Create/edit/delete (soft-delete, undoable) projects.
- Inline-edit name, next action, notes. Todo list: add / check / reorder / delete, done items sink.
- Notes are freeform scratch - the native offload format, not a rigid form.

### 4. Project context & resource retrieval (the new heart)
- **Project card** (tiny, structured): purpose, repos, services, active goal, key aliases. The *only* thing always injected into the agent. No growing markdown dump in every turn.
- **Resource registry** replaces the flat link list: typed records (title, kind, url-or-query, service, env, aliases, description, provenance, confidence, last_used, last_verified, failure_count). Retrieved on demand, never all injected - so hundreds scale fine.
- **Resolver** maps fuzzy language → the right record(s), returns a **cited** answer, and says "no source saved" instead of guessing. This is the load-bearing part.
- **Capture:** paste/drop a URL → agent proposes a typed record for one-click accept (undoable); "remember this" from chat; save a run query as a named resource. No hand-filing into folders.
- **Retrieve:** ask in English ("how's the service mesh latency?") → resolver picks the source (inspectable citation), runs it via the wired MCP server when possible, answers with the live value + link. Honest when a source is missing.
- **Maintenance as a byproduct of use:** failed retrievals / broken links mark records *suspect* automatically; stale records surface only when relevant to the current question, never as a chore list. Semantic rewrites of important mappings need one-tap approval.
- **Browse:** auto-grouped Resources view (by tool / service / derived topic); grouping computed, overrides rare + visible. Never a taxonomy I maintain.
- **Recommend across sources (read-only):** for a broader operational question ("rolling out this flag - what should I monitor?"), the resolver returns the top-k relevant resources with a one-line *why* each and citations, ranked by a fast Copilot model over resource metadata. It never asserts a live value it didn't read - citations mean "relevant," not "verified."
- **MCP wiring:** the app-owned resolver reads the project's wired MCP servers (Datadog, Splunk, Kusto, …) directly - so retrieval *answers* with a live value instead of just pointing. The app owns every live read; Copilot only ranks/recommends, never executes the read.

### 5. Copilot - delegate to the installed app (the spine)
- Hand a task to Copilot from the next action, a todo, a notification, or a freeform prompt. Focus delegates it to the **installed GitHub Copilot desktop app** over its local WebSocket and stores the returned session id - no bundled CLI, no embedded chat to steer.
- Layered delegation: the desktop app when it's running and a trusted local checkout resolves → cloud `gh agent-task` otherwise. An explicit "open untracked in the app" deep link is available as a manual escape hatch.
- The delegated session shows up **on its todo**: a "Copilot working on this →" link (`github-app://sessions/<id>`) plus live status, only for sessions Focus created. Degrades gracefully when the app is closed (last-known status; the link still launches it).
- The WS is the app's **unofficial** protocol, contained behind one adapter (`src/main/agent/copilot-app/`) so an app update can only break one seam; the cloud path stays the resilient fallback. Never log/leak the WS token (it rotates per app launch).

### 6. Copilot - cloud agent tasks (delegate / fallback)
- Launch a `gh agent-task` from any action/todo/notification with one click; then walk away. Also the **resilient fallback** when the desktop app isn't running or no local checkout resolves.
- Tracked in the same session model; status dot on the rail; result folded into the re-entry digest.
- Read-only w.r.t. GitHub beyond launching + unsubscribe (no commenting, no review write-back) in v1.

### 7. GitHub notifications (supporting input)
- Async sync off the render thread (unchanged). Local-first render; content prefetch in background.
- Auto-close on PR merged / issue closed. Unsubscribe write-back. Read state local.
- Routing + filters as v1, but the surface lives behind ⌘K / the project's Notifications tab, and feeds the digest.

### 8. Snooze (blame-free)
- Manual / date-based / notification-triggered (unchanged mechanics).
- Snoozed projects drop off the rail into a quiet collapsed section. No nag, no guilt, no streak.

### 9. Appearance (professional)
- New **Primer-inspired token layer** (see Design System). Drop DaisyUI.
- Light / dark / dim / high-contrast via data attributes; system-preference aware; overridable.
- Mona Sans (UI) + Monaspace Neon (code/agent output); Lucide icons; 4px grid; 150ms transitions; native macOS chrome.

---

## Design system

Replace the current DaisyUI + DM Sans + warm-linen look with a **Primer-inspired** system (modeled on `~/repos/github-app`), kept lightweight (CSS Modules + Tailwind v4 tokens; **not** heavyweight `@primer/react`).

- **Color:** monochrome neutral ramp (11 steps) + a single blue accent. Red/green/yellow semantic only. Borders semi-transparent (~40% of a mid neutral). Restraint over decoration.
- **Type:** Mona Sans (UI, 400 body / 600 headings+buttons), Monaspace Neon (code + agent transcripts). `-apple-system` fallback.
- **Icons:** Lucide (consistent 2px stroke), sized 12/16/24.
- **Spacing:** 4px grid → 8/12/16/24. **Radii:** 2 small / 4 default / 8 large / full. **Transitions:** 150ms.
- **Theming:** `data-color-mode` / `data-theme-tone` attributes + CSS-var injection; theme choice persisted; `prefers-color-scheme` when "system"; `prefers-reduced-motion` respected.
- **Native details:** 12px root corner radius, traffic-light padding, native overlay scrollbars, 2px blue focus outline (-1px offset), F6 landmark navigation.
- **Feel:** calm, restrained, generous whitespace, one primary action per surface.

The existing HTML design handoff (`requirements/design_handoff/`) is now **superseded** for the color/type language (it's the warm-linen direction). Its layout instincts (focus banner, links strip, tabbed detail) still inform the working column.

---

## Architecture

Non-negotiable constraints (carried from v1, reinforced by the profiles):

- **All I/O off the render thread.** GitHub API, SQLite, and agent subprocess management live in the Electron **main process**. Renderer never blocks.
- **Local-first.** UI always renders from local SQLite; network/agent results populate in place.
- **Typed IPC** only (`src/shared/ipc-channels.ts`), `domain:action` naming, `invoke/handle` + push events.
- **No `any`.** Named exports. `async/await`. Strict null checks.

New/changed pieces:

- **Copilot-app adapter** (`src/main/agent/copilot-app/`): the single seam over the desktop app's **unofficial** local WebSocket - discover (port/token), a typed protocol (`create_session`/`send_message`/`session_created`/status), a trusted-cwd resolver, and a delegate strategy that falls back to cloud `gh agent-task`. Contained so an app update can only break one module.
- **Delegated-session tracking:** store the session ids Focus created; read their status **read-only** (targeted query of the app's local session store, or its WS event stream, filtered to our ids) so the todo chip + rail dot reflect live progress. Only ever surface sessions Focus delegated.
- **Session stores:** cloud `gh agent-task` sessions mirror into `copilot_sessions` (synced from `gh agent-task list`); delegated desktop-app sessions live in a dedicated `copilot_app_sessions` store (id, project, cwd, status) so the two kinds never collide. No local transcript store - the app owns its own transcripts.
- **Context & resource subsystem** (the make-or-break piece): a **two-layer context model**, not a markdown dump.
  - *Project card* (small, always injected): purpose, repos, services, active goal, aliases.
  - *Resource registry* (typed records in SQLite, retrieved on demand): title, kind, url-or-query, service, env, aliases, description, provenance, confidence, last_used, last_verified, failure_count.
  - *Context assembler* (own module, tested + hard-capped): given a question, injects the project card + top-scored resources only.
  - *Resolver* (own module, backed by the eval harness): fuzzy question → cited source; runs it via MCP when available; returns "no source saved" instead of guessing; marks records suspect on failure. A fast read-only **recommendation** mode ranks the top-k relevant resources over their metadata via the installed `copilot` CLI (fast model), citations-as-suggestions, never asserting an unread value.
- **App-owned MCP reads:** the resolver reads the project's wired MCP servers directly to produce live values; the decide/recommend steps spawn the installed `copilot` CLI **tool-less** (no MCP, no writes) so Copilot only ranks and the app owns every read. No per-agent MCP wiring to bundle.
- **Trusted-cwd resolver:** desktop delegation needs a real on-disk checkout; Focus only delegates over WS when a configured, validated checkout matches the exact `owner/repo` (a git worktree with a matching remote), else it falls back to cloud. Focus never manages the user's checkouts itself.
- **Digest engine:** computes the re-entry digest from `last_seen_at` + session/notification/PR deltas, and classifies projects parked vs. drifting.

```
main/
  agent/
    copilot-app/         # the one adapter over the desktop app's local WS
      discover.ts        # read ~/.copilot/run/ws.{port,token} (read-only)
      protocol.ts        # typed create_session/send_message/session_* messages
      cwd.ts             # trusted local-checkout resolver (exact owner/repo)
      client.ts          # one ws connection (no Origin header)
      delegate.ts        # WS -> cloud fallback strategy (discriminated result)
      store.ts           # copilot_app_sessions (id, project, cwd, status)
    github-cloud/        # gh agent-task path (evolves current src/main/copilot/)
  context/
    registry.ts          # typed resource records (SQLite) + provenance/health
    assemble.ts          # two-layer context: project card + on-demand retrieval (capped)
    resolve.ts           # fuzzy question -> cited source; recommend top-k (fast CLI)
    capture.ts           # paste/enrich -> proposed typed record
  digest/                # re-entry digest + parked/drifting classification
  notifications/         # sync + routing + filters (existing, demoted)
  db/                    # existing
  auth/                  # existing
  snooze.ts              # existing
shared/  ipc-channels.ts # + delegate + session-status + resolve/recommend channels
renderer/
  pages/Focus.tsx        # the single-focus home (replaces Dashboard as primary)
  components/FocusRail, ReentryDigest, DelegateComposer, TodoSessionChip, QuickSwitcher, ResourcePanel
```

---

## Open technical validations

**The resolver is the make-or-break spike (Gate 0), kept as a regression harness.** The embedded-agent validations that used to live here - SDK availability/licensing, CLI bundling/auth, worktree ergonomics, permission-card coverage, per-agent MCP config - are **retired**: a WS spike proved Focus can drive the *installed* Copilot desktop app and reuse the *installed* `copilot` CLI, so there's no 254 MB binary to bundle, sign, or license, and no embedded permission surface to build.

What remains worth stating honestly:

1. **Resolver quality (the make-or-break gate — Gate 0).** One real project, ~25 typed records, ~20 fuzzy questions plus deliberate negative/ambiguous cases, a pass rubric fixed up front, kept as a regression harness. This gates the brain (MVP C + the read-only recommendation). MVP A/B never depended on it.
2. **The desktop-app WS is unofficial and fragile.** It only works when the app is running; the token rotates per launch; local delegation needs a checkout on disk. Mitigation: one contained adapter + cloud `gh agent-task` fallback + honest degradation when the app is closed. If a spike-verified mechanic stops holding against a new app build, the adapter is the one place to fix, and the cloud fallback keeps delegation working meanwhile.
3. **Verify `better-sqlite3` + `ws` build/run under `bun run setup`** against Electron's ABI. `ws` is JS-only in our usage (its optional native speedups — `bufferutil` / `utf-8-validate` — aren't required), and it's main-process only.

---

## Out of scope

- GitHub write-back beyond launching agent tasks + unsubscribe (no commenting, no review submission) in v1.
- Multi-user / team / cloud sync of local state (single machine).
- Mobile or non-macOS targets.
- Gantt/sprints/velocity/enterprise-PM concepts.
- Streaks, activity graphs, or any engagement-nag mechanic (actively harmful for this user).

**Integrations - reclassified (not a flat "GitHub + Copilot only"):**
- **App-native:** GitHub + Copilot. The app talks to these directly.
- **Resource providers (via MCP):** Datadog / Splunk / Kusto and similar. These are *optional* per project, but at least one real provider is **required to validate the project-brain concept** (the "how's mesh latency?" success criterion is fake without one). New providers are added as MCP servers, not bespoke integrations - so "beyond GitHub" is in scope specifically as pluggable resource providers, and nothing else.

---

## Success criteria (staged gates, smallest-first)

Not one all-or-nothing bar. Each gate ships daily personal value on its own, and the Copilot-app integration is deliberately last.

**Gate 0 - Resolver spike (proof, not shippable):**
- The resolver picks the right source and answers with a citation (or honestly says "no source saved") on the real eval set - run against MCP tools directly, no app shell yet. This gates MVP C and the read-only recommendation path (not MVP A/B); if it fails, rethink the brain before building the brain UI.

**MVP A - Single-focus shell + re-entry:**
1. Home opens to a single focused project; other projects are landmarks + ⌘K, never a competing dashboard.
2. Returning to a focus shows a blame-free "since you were here" digest computed from real deltas (from existing notification/session data).
3. Drifting vs. parked projects are distinguished; drifting ones resurface gently without me remembering to look.
4. No UI lockup (I/O off the render thread); undo covers destructive actions.

**MVP B - Cloud-agent completion loop:**
5. I can launch a **cloud** `gh agent-task` from an action/todo/notification and get re-oriented on its result later via the digest + rail status.

**MVP C - Project brain (the heart), no embedded agent required:**
6. Asking "how's the service mesh latency?" resolves to the right saved resource and, where an MCP source is wired, returns the live value with an inspectable citation.
7. Adding a resource is one low-friction step (paste → agent proposes a typed record → one-tap accept); no hand-built tree/taxonomy; browse view auto-grouped.
8. Stale/broken resources are marked suspect on failure and surface only when relevant - no chore list.

**Copilot-app integration (only after Gate 0 + MVP A-C) - replaces the retired embedded agent:**
9. I hand a task to Copilot and it runs in the **installed desktop app** over its local WS (cloud `gh agent-task` when the app isn't running) - no bundled binary.
10. A delegated todo shows a live "Copilot is on it" status and a one-click link that reopens the session in the app.
11. Asking a broad operational question ("what should I monitor for this rollout?") returns the top-k relevant saved resources with a why each and citations - read-only, via the installed CLI - or honestly says it has nothing saved.

**Cross-cutting (land across the gates, not a final big-bang):**
12. Notifications still sync, route, filter, auto-close, and unsubscribe - from the demoted surface.
13. Snooze works in all three modes with no nagging.
14. The Primer-inspired design system (monochrome + blue, Mona Sans/Monaspace, Lucide, data-attribute theming) in light + dark + one more mode. Deliberately not gating the cognition-layer proof.

**Success looks like:** I open the app, it tells me *one* thing and catches me up on what moved. I ask it "how's X?" and it answers from the project's brain, with a citation, instead of making me hunt a bookmark. The boring finish is one click from being handed to Copilot. Drifting threads come back to me on their own. Nothing nags, nothing shames, nothing needs grooming.
