# Milestones (staged gates)

Smallest-first. Each gate ships daily personal value on its own. Two independent tracks converge:
- **Track 1 (no brain dependency):** MVP A (focus + re-entry) → MVP B (cloud-agent loop). Worth shipping even if the resolver never pans out.
- **Track 2 (gated on Gate 0):** the resolver proof → MVP C (brain in-app) → the Copilot-app integration (delegate to the installed Copilot app + fast read-only brain recommendation via the installed CLI, cloud fallback).

Order rule: don't build the brain UI (C) on an unproven resolver, and don't build heavy agent machinery before the cheaper value lands. A/B and Gate 0 can proceed in parallel.

> The v1 app's milestone plan is archived at `milestones-v1-archive.md`.

---

## Gate 0 - Resolver spike (proof, not shippable)

**Goal:** prove the "project brain" is real before building anything around it.

- Pick one real project; ingest ~25 real dashboards/queries as typed records with known-correct answers.
- Build the minimal resolver + context assembler (no app shell).
- **Define the pass rubric before writing resolver code:** fixed corpus, expected source ID per question, target % right-source, target % correct "no source saved" on negatives, and correct clarify-or-top-candidates behavior on ambiguous queries.
- Run the eval set (~20 fuzzy questions + deliberate negative/ambiguous cases); keep it as a regression harness in the repo.

**Kill criterion (scoped):** if the resolver can't clear the rubric, stop and rethink the brain **before building MVP C or the Copilot-app recommendation path**. It does *not* block MVP A/B - the focus shell, re-entry, and cloud-agent loop are worth shipping regardless.

**Uses:** MCP tools directly. Needs none of the embedded-agent machinery.

---

## MVP A - Single-focus shell + re-entry

**Goal:** the app is worth opening daily even with zero agent features.

- Primer-inspired token layer stood up (drop DaisyUI); light + dark.
- Single-focus home: one project front-and-center; others are rail landmarks + ⌘K.
- Re-entry digest from **existing** notification/session data (no new agent needed).
- Parked vs. drifting classification; gentle resurfacing that doesn't rely on ⌘K.
- All I/O off the render thread; undo on destructive actions.

**Shippable signal:** I open it, see one thing, get caught up, and nothing nags.

---

## MVP B - Cloud-agent completion loop

**Goal:** hand the tedious finish to Copilot and get re-oriented on the result.

- Launch a `gh agent-task` from a next-action / todo / notification (evolves current read-only `src/main/copilot/`).
- Track in the shared session model; rail status dot; result folded into the digest.
- Read-only vs. GitHub beyond launch + unsubscribe.

**Shippable signal:** I delegate a boring task, walk away, and the digest tells me when it's done.

---

## MVP C - Project brain in the app (the heart)

**Goal:** ship Gate 0's proven resolver as a real feature. **No embedded agent required.**

- Resource registry (typed records + provenance/health) in SQLite.
- Capture: paste/drop URL → proposed typed record → one-tap accept (undoable).
- Retrieve: ask in English → cited answer, run via wired MCP when available.
- Maintenance-by-use: failures mark records suspect; stale surfaces only when relevant.
- Auto-grouped browse view; overrides rare + visible.

**Shippable signal:** "how's mesh latency?" answers from the brain, with a citation, instead of a bookmark hunt.

---

## Copilot-app integration (A + B + C) - replaces the retired embedded agent

**What changed:** MVP D was originally an *embedded* local coding agent - bundling the 254 MB Copilot CLI (plus `@github/copilot-sdk`), an `IAgentBackend` port, per-project git worktrees, and inline permission cards, gated behind five validation spikes. A WS spike proved a much lighter path: **drive the already-installed GitHub Copilot desktop app** and **reuse the installed `copilot` CLI**, with cloud `gh agent-task` (MVP B) as the fallback. So the heavyweight embedded agent is retired and replaced by three smaller, independently-shippable touchpoints.

**Honest about the seams:** the delegate path rides the desktop app's **unofficial** local WebSocket - contained behind one adapter, with cloud agent-task as the resilient fallback. It only works when the app is running (and, for local delegation, when the repo is checked out on disk); the WS token rotates per app launch. The open-in-app link and the CLI recommendation path use sanctioned/public interfaces.

### A - Delegate to the Copilot desktop app

**Goal:** handing off a task runs it locally in the installed Copilot app, not in a bundled binary.

- Delegate from a next-action / todo / notification over the app's local WS (`create_session` → `send_message`); store the returned session id.
- Layered fallback: WS when the app is running (and a trusted local checkout resolves) → cloud `gh agent-task` otherwise. An explicit deep-link "open untracked in the app" is available as a manual escape hatch.
- Isolate the WS behind one adapter (`src/main/agent/copilot-app/`) so an app update can only break one seam. Never log/leak the WS token.

**Shippable signal:** I hand a task to Copilot and it opens in the desktop app (or cloud when the app isn't running), with no giant binary bundled.

### B - Show the delegated session on its todo

**Goal:** the organization/visibility win - see the delegated session where the work lives.

- Store the session id on the todo; a "Copilot working on this →" link opens it in the app (`github-app://sessions/<id>`).
- Live status (working / needs you / done), only for sessions Focus created; degrade gracefully when the app is closed.

**Shippable signal:** a delegated todo shows a live "Copilot is on it" chip, and one click reopens the session in the app.

### C - Fast read-only brain recommendation via the installed CLI

**Goal:** quick operational recommendations over the project brain - "rolling out this flag, what should I monitor?"

- Evolve the MVP C resolver from single-source retrieval to **recommendation over the top-k** relevant resources (relevant dashboards/queries + a one-line *why* each), with citations.
- Reuse the installed `copilot` CLI with a **fast model**; read-only; no bundle.
- Honest when the brain lacks the sources to answer (no fabrication; citations mean "relevant," not "verified").

**Shippable signal:** asking "what should I watch for this rollout?" returns the N relevant saved resources with a one-line why each, or says it has nothing saved.

---

## Cross-cutting (lands across gates, not a big-bang)

- Notifications: sync / route / filter / auto-close / unsubscribe - carried from v1, demoted behind ⌘K + the Notifications tab. (Feeds MVP A's digest.)
- Snooze: three modes, no nagging. (Ties into MVP A's parked/drifting.)
- Design system: extra theme modes (dim / high-contrast) + polish. Deliberately not gating the cognition-layer proof.
