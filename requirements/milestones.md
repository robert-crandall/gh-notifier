# Milestones (staged gates)

Smallest-first. Each gate ships daily personal value on its own. Two independent tracks converge:
- **Track 1 (no brain dependency):** MVP A (focus + re-entry) → MVP B (cloud-agent loop). Worth shipping even if the resolver never pans out.
- **Track 2 (gated on Gate 0):** the resolver proof → MVP C (brain in-app) → MVP D (embedded agent, last, behind validations).

Order rule: don't build the brain UI (C) on an unproven resolver, and don't build the agent platform (D) before the cheaper value lands. A/B and Gate 0 can proceed in parallel.

> The v1 app's milestone plan is archived at `milestones-v1-archive.md`.

---

## Gate 0 - Resolver spike (proof, not shippable)

**Goal:** prove the "project brain" is real before building anything around it.

- Pick one real project; ingest ~25 real dashboards/queries as typed records with known-correct answers.
- Build the minimal resolver + context assembler (no app shell).
- **Define the pass rubric before writing resolver code:** fixed corpus, expected source ID per question, target % right-source, target % correct "no source saved" on negatives, and correct clarify-or-top-candidates behavior on ambiguous queries.
- Run the eval set (~20 fuzzy questions + deliberate negative/ambiguous cases); keep it as a regression harness in the repo.

**Kill criterion (scoped):** if the resolver can't clear the rubric, stop and rethink the brain **before building MVP C or D**. It does *not* block MVP A/B - the focus shell, re-entry, and cloud-agent loop are worth shipping regardless.

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

## MVP D - Embedded local agent (last, gated)

**Goal:** the "sit and steer" spine - only after the validations pass.

**Precondition:** validations 2-6 in the PRD (SDK availability, CLI auth/bundling, worktree ergonomics, permission coverage, MCP wiring) clear. If the SDK path fails, this degrades to a richer cloud-agent experience and the brain still stands.

- Backend port + `copilot-local` backend (SDK/CLI subprocess).
- Turn normalizer → throttled `session:view` snapshots; state-machine-driven UI.
- Scoped inline permission cards.
- Transcript persistence + re-hydrate on resume.
- Per-project worktree sandbox.

**Shippable signal:** I start a local turn scoped to a project, watch it stream, approve tools inline, and pick it back up later re-oriented.

---

## Cross-cutting (lands across gates, not a big-bang)

- Notifications: sync / route / filter / auto-close / unsubscribe - carried from v1, demoted behind ⌘K + the Notifications tab. (Feeds MVP A's digest.)
- Snooze: three modes, no nagging. (Ties into MVP A's parked/drifting.)
- Design system: extra theme modes (dim / high-contrast) + polish. Deliberately not gating the cognition-layer proof.
