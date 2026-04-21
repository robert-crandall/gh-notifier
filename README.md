# Focus

A personal project management tool for developers. Surfaces GitHub notifications in the context of the projects they belong to.

macOS only.

---

## Prerequisites

- [Bun](https://bun.sh) — the only supported package manager/runtime (`npm`/`node` are not required)
- Xcode Command Line Tools — required to compile `better-sqlite3` (`xcode-select --install`)
- A GitHub OAuth App — create one at https://github.com/settings/developers. The callback URL can be anything (e.g. `http://localhost`) since this app uses the Device Flow.

---

## Setup

```bash
# 1. Copy the env template and fill in your GitHub OAuth App client ID
cp .env.example .env
# edit .env and set VITE_GITHUB_CLIENT_ID=your_client_id_here

# 2. Install deps and rebuild better-sqlite3 for Electron's ABI
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
