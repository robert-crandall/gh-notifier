# AGENTS.md — gh-notifier

## Agent: Implement

When implementing a feature or fixing a bug, follow this workflow:

1. Read the relevant milestone in `requirements/milestones.md` for context on what phase the project is in.
2. Make the smallest change that satisfies the request.
3. Run all three quality gates before considering work done:
   ```bash
   cd src-tauri && cargo fmt --check && cargo clippy && cd .. && bun run check
   ```
4. Fix any warnings or errors — do not suppress clippy lints without a documented reason.

### Rust rules
- 2-space indentation (not 4). See `src-tauri/rustfmt.toml`.
- Clippy pedantic is enabled. All warnings must be resolved.
- All Tauri commands go in `src-tauri/src/commands.rs`. Models in `models.rs`.
- Return `Result<T, String>` from Tauri commands.
- When adding a new command, also register it in `lib.rs` and add a typed wrapper in `src/lib/api.ts`.

### Frontend rules
- Svelte 5 runes only (`$state`, `$derived`, `$effect`). No legacy reactive `let`.
- Types in `src/lib/types.ts`. API wrappers in `src/lib/api.ts`.
- Tailwind classes only — no `<style>` blocks.
- Follow the design tokens in `tailwind.config.js` and `requirements/DESIGN.md`.

### Testing rules
- **Currently (pre-M1):** No unit tests — backend is entirely stubs.
- **After M1:** Add `#[cfg(test)]` unit tests for `db.rs`.
- **After M2:** Add unit tests for `github.rs` with mocked HTTP.
- **After M3:** Add unit tests for thread mapping logic.
- Never write tests for stub/no-op code.

## Agent: Review

When reviewing code or a diff:

1. Check that all three quality gates would pass.
2. Verify Rust uses 2-space indentation and respects `max_width = 100`.
3. Confirm Rust and TypeScript types stay in sync for any model changes.
4. Flag any `<style>` blocks, inline styles, or CSS modules — those violate conventions.
5. Flag any 4-space indentation in Rust files.
6. Ensure no features, refactors, or scope creep beyond what was requested.

## Agent: Plan

When planning work or breaking down a task:

1. Read `requirements/milestones.md` to understand the current phase.
2. Read `requirements/prd.md` for product requirements.
3. Read `requirements/DESIGN.md` for design system constraints.
4. Break work into the smallest shippable increments that follow the milestone order.
5. Each increment must leave all quality gates passing.
