# Copilot Instructions — gh-notifier

## Philosophy

Ship fast but structured. Every change must pass formatters and linters before it's considered done. Tests phase in as real logic lands — don't write tests for stubs.

## Stack

- **Frontend:** Svelte 5, SvelteKit (static adapter, SPA fallback), Tailwind v3, TypeScript
- **Backend:** Rust (Tauri v2 commands)
- **Runtime:** Bun (not npm/yarn/pnpm)
- **Package commands:** `bun install`, `bun run build`, `bun run check`
- **Tauri commands:** `bun run tauri dev`, `bun run tauri build`

## Quality Gates (must pass before any change is done)

1. `cargo fmt --check` — Rust formatting (2-space indentation, see `src-tauri/rustfmt.toml`)
2. `cargo clippy` — pedantic lints enabled (see `src-tauri/.cargo/config.toml`)
3. `bun run check` — `svelte-check` for Svelte + TypeScript type checking

## Rust Conventions

- Clippy pedantic is enabled project-wide. Fix all warnings, don't suppress them unless there's a documented reason.
- 2-space indentation (`tab_spaces = 2` in rustfmt.toml). Do NOT use 4-space Rust defaults.
- `max_width = 100`.
- Use `use_field_init_shorthand` and `use_try_shorthand` (both enabled in rustfmt).
- All Tauri commands live in `src-tauri/src/commands.rs`. Models in `models.rs`.
- Prefer returning `Result<T, String>` from Tauri commands (Tauri's invoke error convention).

## Frontend Conventions

- Svelte 5 runes syntax (`$state`, `$derived`, `$effect`). No legacy `let` reactivity.
- TypeScript types for all data models are in `src/lib/types.ts`. Keep Rust and TS types in sync.
- Tauri command wrappers in `src/lib/api.ts`. All invoke calls go through this layer.
- Tailwind classes only — no inline styles, no CSS modules, no `<style>` blocks unless absolutely necessary.
- Design tokens are in `tailwind.config.js` (colors, fonts). Reference `requirements/DESIGN.md` for the design system.

## Design System

- Font: Inter (400/500/600 weights)
- Icons: Material Symbols Outlined (loaded via Google Fonts CDN in `app.html`)
- No 1px borders for section separation — use background color shifts per the "Digital Lithograph" spec
- Glass panels: `bg-surface-primary/80 backdrop-blur-xl`
- Color tokens: `surface-primary`, `surface-secondary`, `surface-tertiary`, `accent-blue`, `accent-green`, `accent-amber`, `text-primary`, `text-secondary`, `text-tertiary`

## Project Structure

```
src/                    # SvelteKit frontend
  lib/
    api.ts              # Tauri invoke wrappers (18 commands)
    types.ts            # TypeScript data models
  routes/
    +layout.svelte      # App shell (sidebar, top bar)
    +page.svelte        # Dashboard
    inbox/              # Unmapped notifications
    projects/[id]/      # Project detail view
    setup/              # First-time GitHub PAT connection
    settings/           # Token management, sync config
src-tauri/              # Rust backend
  src/
    commands.rs         # All Tauri command handlers
    models.rs           # Data structs (Serialize/Deserialize)
    lib.rs              # Tauri builder + command registration
    main.rs             # Entry point
requirements/
  prd.md                # Product requirements
  DESIGN.md             # Design system specification
  milestones.md         # Engineering roadmap (M1–M6)
  prototypes/           # Original HTML mockups
```

## Current Status

The app is a **UI-first prototype**. All 18 Rust commands are stubbed with hardcoded data. No database, no GitHub API, no persistence. See `requirements/milestones.md` for the build plan.

## Milestones & Testing Strategy

Work follows the milestone order in `requirements/milestones.md`:
- **M1 (SQLite):** Add `db.rs` unit tests after this milestone
- **M2 (GitHub Sync):** Add `github.rs` unit tests (mock HTTP)
- **M3 (Auto-Routing):** Add thread mapping logic tests
- **No E2E tests** planned for MVP — UI is still evolving
- **No CI/CD** — solo dev, manual quality checks

## When Generating Code

- Keep Rust and TypeScript type definitions in sync when modifying data models.
- Don't add features, refactoring, or "improvements" beyond what's asked.
- Don't add error handling for scenarios that can't happen at the current milestone.
- When adding a new Tauri command: add the Rust handler in `commands.rs`, register it in `lib.rs`, and add the typed wrapper in `api.ts`.
