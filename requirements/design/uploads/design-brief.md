# Design Brief - Focus

> For a designer (human or LLM) working on this app. Read alongside `prd.md`.
> This is a set of **opinionated design constraints**, not a persona exercise or a diagnosis. It captures *how this user's mind works with software* so your hundred small decisions land right where the PRD is silent. Treat it as the generative ruleset; when in doubt, design toward these.

---

## The one thing to internalize

Design against **tedium, not difficulty.** This user leans *into* hard, challenging problems and can stay locked on one for hours or weeks. What loses them is boredom, friction, and clutter. So: keep easy paths instant and frictionless; never dumb down or add hand-holding to hard paths; never rescue prematurely. Complexity is welcome; tedium is the enemy.

---

## Core principles

- **One primary thing. Calm surface.** vim, not a Bloomberg terminal. One clear focus fills the screen; everything else is a keystroke/click away. A dense multi-panel dashboard is a failure state.
- **Never force juggling unrelated things.** Let a single problem go arbitrarily deep and multi-faceted - that's this user's strength. But surfaces like "6 pending items across 6 areas" are actively de-motivating. Depth on one thing = good; breadth across many unrelated things = bad.
- **Context is insurance, not convenience.** Persist working state automatically. Never rely on the user to hold it in their head or to remember to save - they systematically over-trust their own recall.
- **Re-orient on return.** When the user comes back after a gap, actively catch them up ("here's where you were, here's what changed") instead of silently restoring state and leaving them to reconstruct it. The return moment is a first-class design surface.
- **Blame-free re-entry.** Framing matters enormously. "Just pick it back up" and neutral orientation beat accountability pressure, streak-guilt, or anything that makes returning to a stalled thing feel like a reprimand. No streaks, no "you haven't touched this in N days," no nag.

---

## Information & density

- **Mode-dependent density.** *Operating* something familiar → show the whole territory. *Learning* something new → progressive disclosure with strong landmarks. Don't pick one fixed density.
- **Visual / spatial, hierarchical.** Prefer diagrams, topology, nested structure to drill into. A navigable tree is a good visual structure. Flat surfaces overwhelm because they destroy the spatial map this user is good at building.
- **Strong landmarks.** In new territory the user *does* get lost - provide breadcrumbs, clear "you are here," orientation cues, especially on first encounter.
- **Scannable by default.** Bullets, short chunks, clear headings - not walls of prose. Reading capacity varies day to day; never make comprehension depend on parsing a dense paragraph. Lead with the scannable version; keep prose optional/expandable.

---

## Decisions, defaults, control

- **Verdict on top of the tradeoffs.** "Here's the one I'd pick and why," with the trade space named underneath. Offloading a decision is valuable. But be honest about stakes - when it's a coin-flip, say so; don't manufacture false confidence.
- **Vanilla defaults, all overridable.** Standard/stock choices are a relief, not a suspicion. Keep every default visible and changeable - the user will rarely override, but wants the door.
- **Undo over confirmation.** A confirmation assumes the user is wrong; an undo trusts them and leaves a door open. Prefer no confirmation + a reliable undo. Build recoverability in (soft-delete everything) so friction isn't needed. Reserve hard confirms for the genuinely unrecoverable.
- **Click-first; shortcuts as reward.** Mouse-comfortable and click-to-discover. Support exploration by clicking; reward fluency with shortcuts; never gate core functionality behind a hotkey.
- **Automate anything done twice.** Every repeated workflow should be scriptable/automatable. Non-negotiable, and it coexists with click-first: pointer for one-offs, scripts for repetition.

---

## Feedback

- **Explicit-but-terse on success; verbose on failure.** A clear checkmark that it worked (don't leave success silent) - but a checkmark, not a paragraph. When something breaks, give full, verbose diagnostics.
- **Instant signal.** Exit-code / checkmark speed, not a delayed report. Never block interaction behind a spinner.

---

## Two constraints specific to this app

- **The last 10% is the hard part.** Task *initiation* and especially *completion* (closing things out) are where this user stalls - not the interesting middle. Design should lower the activation energy to start, and actively help *finish* (this is why Copilot handling the tedious finish is core, not a nice-to-have).
- **Every system has a half-life.** What works fades over time. Don't design a "solve it once" system; expect to rotate and refresh. Make decay *visible in context* rather than pretending the system self-heals or handing the user a maintenance chore list.

---

## Anti-patterns (do NOT do these)

The user has ADHD, but that is **not** license for the usual clichés - most of them actively backfire here:

- ❌ **Gamification / dopamine mechanics** - streaks, badges, XP, progress bars as motivation. They add streak-guilt and become their own chore.
- ❌ **Nagging / notification pressure** - reminders framed as accountability or "you're behind."
- ❌ **Dense dashboards / counts-of-pending** - "12 items across 8 projects." The single most de-motivating surface for this user.
- ❌ **Blocking spinners and confirmation dialogs** - kill flow and imply the user is wrong.
- ❌ **Rigid structured forms** where freeform scratch would do - lightweight capture beats mandatory fields.
- ❌ **Mandatory grooming** - any taxonomy/tags/folders the user must maintain by hand will rot and become the avoidance task.

---

## Litmus test

Before shipping a surface, ask:
1. Is there **one** obvious primary thing, or does it make the user juggle?
2. If the user vanished for 3 days and came back, would this surface **re-orient** them - warmly, without guilt?
3. Is it **scannable** on a low-reading-capacity day?
4. Is every destructive action **undoable** instead of confirmed?
5. Does anything here quietly demand **manual upkeep**?
