# GH Projects

A personal project management tool for developers. Surfaces GitHub notifications in the context of the projects they belong to.

macOS only.

---

## Prerequisites

- [Bun](https://bun.sh) — the only supported package manager/runtime (`npm`/`node` are not required)
- Xcode Command Line Tools — required to compile `better-sqlite3` (`xcode-select --install`)
- A GitHub Personal Access Token — create one at https://github.com/settings/tokens/new with `notifications` and `read:user` scopes. The token is stored locally using Electron's safeStorage (OS-level encryption).

---

## Setup

```bash
# Install deps and rebuild better-sqlite3 for Electron's ABI
bun run setup
```

> `better-sqlite3` is a native module. It must be compiled against Electron's ABI, not Node's. Running plain `bun install` will fail — always use `bun run setup` on first clone or after changing the Electron version.

---

## Development

```bash
# Start Electron + Vite dev server with hot reload
bun run dev
```

---

## Build

```bash
# Compile all targets (main, preload, renderer) into out/
bun run build

# Package as a distributable .dmg
bun run dist
```

---

## Type checking

```bash
bun run typecheck
```

---

## Resetting the notification sync cursor

If notifications go missing (e.g., after debugging or a sync race), clear the stored `since` timestamp so the next sync does a full re-fetch:

```bash
bun run reset:sync
```

Or directly:

```bash
sqlite3 ~/Library/Application\ Support/gh-projects/gh-projects.db \
  "DELETE FROM sync_metadata WHERE key = 'last_notification_sync';"
```

The app must be closed (or will re-sync automatically on the next poll cycle) after running this.

---

## After updating Electron

If you bump the `electron` version in `package.json`, rebuild the native module:

```bash
bun run rebuild
```

---

## Project structure

```
src/
  main/          # Electron main process — IPC handlers, DB access, GitHub sync
  preload/       # Context bridge — exposes typed IPC to the renderer
  renderer/      # React app
    src/
      components/
      hooks/
      pages/
  shared/        # Types and constants shared between main and renderer
db/
  migrations/    # SQL migration files, applied in filename order on startup
requirements/    # PRD and milestone docs (not shipped)
```
