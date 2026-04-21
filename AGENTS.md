# AGENTS.md

Guidance for AI coding agents working in this repository.

---

## Project Summary

**Focus** is a macOS Electron app for solo developers. It's a project management tool that surfaces GitHub notifications in the context of the projects they belong to.

- **Not** a GitHub notification inbox — projects are the primary unit.
- Data lives in local SQLite. All network I/O is off the render thread.
- macOS only. No cross-platform targets.

See [`requirements/prd.md`](requirements/prd.md) for full product requirements.

---

## Repo Layout

```
src/
  main/          # Electron main process — IPC handlers, GitHub sync, DB access
  renderer/      # React app (TypeScript, functional components only)
    components/
    hooks/
    pages/
  shared/        # Types and constants shared between main and renderer
db/              # SQLite schema and migrations
requirements/    # PRD and design docs — not shipped in the app bundle
.github/
  copilot-instructions.md   # Always-on context for Copilot
```

> The source tree above reflects the intended structure. If folders don't exist yet, they will be created as features are implemented.

---

## Build & Dev

```bash
# Install dependencies
npm install

# Start dev server (Electron + Vite hot reload)
npm run dev

# Build the macOS app bundle
npm run build

# Package as a distributable .dmg
npm run dist
```

> These commands will be accurate once the project scaffold is in place. Update this section when the build setup is finalized.

---

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Type-check without emitting
npm run typecheck
```

Tests use **Vitest** (unit) and **React Testing Library** (component). Main-process logic is tested with Vitest directly (no Electron environment needed for unit tests).

---

## Key Constraints for Agents

1. **Never put I/O in the renderer.** GitHub API calls and SQLite access belong in `src/main/`. Use IPC to expose results to the renderer.
2. **No `any` in TypeScript.** Use `unknown` and narrow it.
3. **All async code uses `async/await`.** No `.then()` chains.
4. **Named exports only.** No default exports.
5. **No new dependencies without checking `copilot-instructions.md` first.** Prefer libraries already listed there.
6. **Do not write back to GitHub** except via the explicit unsubscribe IPC channel.

---

## IPC Conventions

All IPC channel names live in `src/shared/ipc-channels.ts` (create if it doesn't exist yet). Channels are typed end-to-end — no untyped `ipcRenderer.send` / `ipcMain.on` calls.

Pattern:
```
domain:action         # e.g. notifications:sync, projects:create
domain:action:reply   # reply channel for invoke/handle patterns
```

---

## Common Task Patterns

### Adding a new IPC handler
1. Define the channel name and payload types in `src/shared/ipc-channels.ts`
2. Register the handler in the appropriate `src/main/` module
3. Call it from the renderer via a typed wrapper in `src/renderer/hooks/` or a utility module

### Adding a new DB table
1. Write a migration in `db/migrations/`
2. Update the schema types in `src/shared/`
3. Add accessor functions in `src/main/db/`

### Adding a new React view
1. Create the component in `src/renderer/pages/` or `src/renderer/components/`
2. Wire data through a hook in `src/renderer/hooks/` that calls IPC
3. Never fetch data directly in a component body
