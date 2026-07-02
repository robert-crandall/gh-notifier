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
- **Copilot is the spine, not a status dot.** Two modes: delegate-and-walk-away (cloud agent) and sit-and-steer (embedded local agent chat).
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
│  inbox (2)    │  Todos/Notes  │  Copilot (embedded agent)     │
│               │  Resources ⌕  │  live streaming · tool status │
│               │  Notifications│  inline permission cards      │
└───────────────┴───────────────┴──────────────────────────────┘
```

- **Focus rail (left, thin):** the projects list as *landmarks*, not a dashboard. One is in focus at a time. Small status dot per project (agent working / needs you / quiet). Inbox pinned at the bottom. Collapsible so the focus can go full-bleed.
- **Re-entry digest (top of focus):** the signature feature. See below.
- **Next action (center):** one line, big, editable inline. Primary button: **Hand to Copilot**. Secondary: Edit, Done.
- **Working column:** Todos · Notes (scratch) · **Resources** (ask-first, see below) · Notifications for this project, as tabs. Progressive disclosure - operating shows the whole territory, but only for the *one* focus.
- **Copilot panel (right):** the embedded agent conversation scoped to this project. This is the Scout-style spine (details below).
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
A unit of Copilot work attached to a project. Two sources, **one session model + one state machine**:

1. **Local embedded agent (interactive - "sit and steer")**
   - Runs the **Copilot CLI as a subprocess** via `@github/copilot-sdk`, cwd = the project's local repo/worktree.
   - Live: streaming text, in-flight tool-status row, reasoning, token usage.
   - **Inline permission cards** (not modal dialogs) for tool actions: allow / allow-for-session / always-allow (persists a *pattern*, not a literal) / deny.
   - This is where I *work with* the agent on the interesting, coupled problem.

2. **Cloud agent task (delegate - "walk away")**
   - The existing `gh agent-task` path. Launch from a next-action / todo / notification, then leave.
   - It surfaces back through the re-entry digest and the rail status dot when it's done or needs me.
   - This is where I offload the tedious **last 10%**.

Both are `AgentSession` rows with a shared status machine:
`idle → submitted → streaming → waiting(needs input / needs approval) → done | error`
(cloud maps `in_progress → waiting → pr_ready → completed` onto the same shape).

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
- **MCP wiring:** the embedded agent is configured with the project's relevant MCP servers (Datadog, Splunk, Kusto, …) - Scout-style - so retrieval *answers* instead of just pointing.

### 5. Copilot - embedded local agent (the new spine)
- Per-project agent conversation panel. Start a turn from the next action, a todo, a notification, or a freeform prompt.
- Backend-agnostic **session port** (borrowed from Scout): shared code never couples to the SDK; Copilot is one backend, cloud `gh agent-task` is another, future backends slot in.
- Renderer subscribes to **throttled `session:view` snapshots** (~100ms), not raw event firehose. State machine drives the UI.
- Inline permission cards with risk/category badges + output preview; always-allow persists a reproducible *pattern* with an **explicit, narrow scope** (per-project, per-tool, bounded arg pattern) so it can't silently widen into blanket permission.
- Transcripts persisted locally and **re-hydrated on resume** so returning to a session re-orients me.
- **Sandbox:** the agent works in a per-project git **worktree** by default, so "YOLO speed" has a trailing safety net (recoverable by design, matches my risk profile).

### 6. Copilot - cloud agent tasks (delegate)
- Launch a `gh agent-task` from any action/todo/notification with one click; then walk away.
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

- **Agent backend port** (`IAgentBackend`): `start(prompt, ctx)`, `send(sessionId, msg)`, `abort(sessionId)`, `resolvePermission(...)`, event stream. Implementations: `copilot-local` (SDK/CLI subprocess) and `github-cloud` (`gh agent-task`). Shared session/session-view code is backend-blind.
- **Turn accumulator + normalizer:** raw SDK/CLI events → canonical `TurnEvent`s → throttled `session:view` snapshots broadcast to the renderer.
- **Agent session store:** metadata in SQLite; transcripts on disk (encrypted via Electron `safeStorage`, Scout-style); re-hydrate on resume.
- **Context & resource subsystem** (the make-or-break piece): a **two-layer context model**, not a markdown dump.
  - *Project card* (small, always injected): purpose, repos, services, active goal, aliases.
  - *Resource registry* (typed records in SQLite, retrieved on demand): title, kind, url-or-query, service, env, aliases, description, provenance, confidence, last_used, last_verified, failure_count.
  - *Context assembler* (own module, tested + hard-capped): given a question, injects the project card + top-scored resources only.
  - *Resolver* (own module, backed by the eval harness): fuzzy question → cited source; runs it via MCP when available; returns "no source saved" instead of guessing; marks records suspect on failure.
- **Per-project MCP config:** the `copilot-local` backend starts each session with the project's wired MCP servers (Datadog / Splunk / Kusto / …) so retrieval can run live queries, not just point at links (Scout pattern).
- **Worktree manager:** create/reuse a git worktree per project for the local agent's cwd; the safety net for agent file writes.
- **Digest engine:** computes the re-entry digest from `last_seen_at` + session/notification/PR deltas, and classifies projects parked vs. drifting.

```
main/
  agent/
    port.ts              # IAgentBackend + shared session types
    copilot-local/       # @github/copilot-sdk subprocess backend (+ per-project MCP config)
    github-cloud/        # gh agent-task backend (evolves current src/main/copilot/)
    normalize.ts         # raw events -> canonical TurnEvent
    session-view.ts      # accumulate + throttle -> snapshots
    store.ts             # metadata (SQLite) + transcript (disk, encrypted)
    worktree.ts          # per-project git worktree sandbox
  context/
    registry.ts          # typed resource records (SQLite) + provenance/health
    assemble.ts          # two-layer context: project card + on-demand retrieval (capped)
    resolve.ts           # fuzzy question -> cited source (+ eval harness)
    capture.ts           # paste/enrich -> proposed typed record
  digest/                # re-entry digest + parked/drifting classification
  notifications/         # sync + routing + filters (existing, demoted)
  db/ auth/ snooze.ts    # existing
shared/  ipc-channels.ts # + agent + context + digest channels
renderer/
  pages/Focus.tsx        # the single-focus home (replaces Dashboard as primary)
  components/FocusRail, ReentryDigest, AgentPanel, PermissionCard, QuickSwitcher, ResourcePanel
```

---

## Open technical validations (do NOT hand-wave these)

Before committing to the embedded-agent milestones, verify:

1. **Resolver quality (the make-or-break spike, do this FIRST).** Pick one real project; ingest ~25 real dashboards/queries as typed records with known-correct answers. Ask ~20 real fuzzy questions ("how's mesh latency?") **plus deliberate negative/ambiguous cases** (things with no saved source, and things that could match two sources). Define the **pass rubric up front**: fixed corpus, expected source ID per question, ≥ target % right-source-chosen, ≥ target % correct "no source saved" on negatives, and correct clarify-or-top-candidates behavior on ambiguous ones. Keep it as a regression harness in the repo. **If this doesn't clear the bar, the "project brain" thesis (MVP C/D) is wrong - but MVP A/B don't depend on it, so they can still ship.**
2. **`@github/copilot-sdk` availability + licensing** for a personal, non-Microsoft app. Scout bundles it; confirm we can depend on it (or fall back to spawning the `copilot` CLI directly with our own protocol). **Blocker-class risk.**
3. **Copilot CLI bundling / auth** - how the subprocess authenticates (reuse `~/.copilot`? isolated home like Scout's `~/.scout/copilot`?), and build-size impact.
4. **Worktree sandbox ergonomics** - creating/cleaning worktrees per project without surprising the user's real checkout.
5. **Permission-card coverage** - which tool categories must prompt (shell, file write, network) vs. auto-allow (reads).
6. **Resource enrichment + per-project MCP config** - enriching a pasted dashboard URL may need auth (Datadog/Splunk/Kusto behind SSO); prefer resolving titles/metadata *through the wired MCP server* over scraping the URL. Confirm the SDK lets us attach per-project MCP servers and that the observability MCPs expose the lookups the resolver needs.
7. **`better-sqlite3` + new native deps** still build against Electron's ABI under `bun run setup`.

These become spikes at the front of the milestone plan. Note the dependency: the resolver spike (1) validates the *core value* and needs almost none of the embedded-agent machinery (2-6) - it can run against MCP tools directly. If (2) fails, the embedded-agent spine degrades gracefully to a richer cloud-agent experience; the project brain survives either way.

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

Not one all-or-nothing bar. Each gate ships daily personal value on its own, and the risky embedded-agent platform is deliberately last.

**Gate 0 - Resolver spike (proof, not shippable):**
- The resolver picks the right source and answers with a citation (or honestly says "no source saved") on the real eval set - run against MCP tools directly, no app shell yet. This gates everything else; if it fails, rethink the brain before building UI.

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

**MVP D - Embedded local agent (only after Gate 0 + validations 2-6 pass):**
9. I can start a **local embedded** Copilot turn scoped to a project, watch it stream, and approve tool actions via scoped inline permission cards.
10. Agent sessions persist and re-hydrate on resume.

**Cross-cutting (land across the gates, not a final big-bang):**
11. Notifications still sync, route, filter, auto-close, and unsubscribe - from the demoted surface.
12. Snooze works in all three modes with no nagging.
13. The Primer-inspired design system (monochrome + blue, Mona Sans/Monaspace, Lucide, data-attribute theming) in light + dark + one more mode. Deliberately not gating the cognition-layer proof.

**Success looks like:** I open the app, it tells me *one* thing and catches me up on what moved. I ask it "how's X?" and it answers from the project's brain, with a citation, instead of making me hunt a bookmark. The boring finish is one click from being handed to Copilot. Drifting threads come back to me on their own. Nothing nags, nothing shames, nothing needs grooming.
