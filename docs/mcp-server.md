# Copilot MCP integration

GH Projects exposes an **inbound MCP server** so the GitHub Copilot CLI can call the
app's own tools - reading project context and filing human-gated todos - without the
app ever writing back to GitHub. This doc covers two separate things:

- **A. MCP tool registration** - how the app wires its server into `~/.mcp.json` so
  Copilot can discover and spawn it.
- **B. Skill install / discovery** - how the `gh-projects` skill teaches Copilot
  *when and how* to use those tools.

They are independent: registering the server makes the tools *available*; installing
the skill makes Copilot *use them well*. You generally want both.

The tool surface itself is documented for the model in
[`.github/skills/gh-projects/SKILL.md`](../.github/skills/gh-projects/SKILL.md).

---

## What it is

- A **loopback MCP server** runs inside the Electron main process, bound to
  `127.0.0.1:<ephemeral>`, speaking MCP over Streamable HTTP
  (`src/main/mcp-server/server.ts`).
- A small, self-contained **stdio shim** (`build/mcp-shim.cjs`, built from
  `src/main/mcp-server/shim/entry.ts`) is what the Copilot CLI actually spawns. It
  bridges Copilot's stdio channel to the loopback server:

  ```
  Copilot CLI  <--stdio-->  [mcp-shim.cjs]  <--Streamable HTTP-->  loopback server (in the app)
  ```

The shim is bundled into the app so the two ends ship together and can't drift.

---

## A. MCP tool registration (`~/.mcp.json`)

The app manages a single entry keyed **`gh-projects`** in your global `~/.mcp.json`
(`src/main/mcp-server/mcp-json.ts`). The written entry looks like:

```jsonc
{
  "mcpServers": {
    "gh-projects": {
      "command": "/path/to/GH Projects.app/Contents/MacOS/GH Projects", // process.execPath - the Electron binary
      "args": ["/path/to/mcp-shim.cjs"],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1",       // run the Electron binary as plain Node
        "GH_PROJECTS_MCP_MANAGED": "1"      // ownership marker - see below
      }
    }
  }
}
```

Why this shape (`src/main/mcp-server/lifecycle.ts`, `buildShimCommand`):

- The **command is the app's own Electron binary run as Node**
  (`ELECTRON_RUN_AS_NODE=1`) against the unpacked `mcp-shim.cjs`. That means there's
  no dependency on a system `node` or `bun` being installed, and no script-in-asar
  execution.
- The `GH_PROJECTS_MCP_MANAGED=1` env var is an **ownership marker**. The app only
  ever adds, updates, or removes a `gh-projects` entry that carries this marker (or is
  absent). If you hand-authored your own `gh-projects` entry without the marker, the
  app **leaves it untouched** - it will never clobber your config.
- Writes are **atomic** (temp file + same-directory rename), and any unrelated servers
  or top-level keys in `~/.mcp.json` are preserved. A present-but-unparseable
  `~/.mcp.json` is treated as a hard error and is never overwritten.

### Enable / disable

- The server is **enabled by default** (`src/main/mcp-server/settings.ts` - an unset
  setting means enabled).
- On app launch, if enabled, the app **starts the loopback server and registers the
  shim** in `~/.mcp.json` (`src/main/index.ts`).
  - **Dev caveat:** registration only happens when the shim bundle actually exists at
    the expected path. In a dev checkout **before `bun run build:shim`** has produced
    `build/mcp-shim.cjs`, the app **skips registration and logs a warning** rather than
    pointing Copilot at a missing command. Run `bun run build` (which runs
    `build:shim`) first.
- There is an IPC channel `settings:set-mcp-server-enabled` that starts/stops the
  server and adds/removes the `~/.mcp.json` entry. There is **no renderer UI toggle for
  this yet** - the behavior is default-on plus that IPC channel.

### Runtime discovery files (`~/.gh-projects/run/`)

While the app is running it publishes two files the shim reads to find and
authenticate to the loopback server (`src/main/mcp-server/runfiles.ts`):

- `~/.gh-projects/run/token` - a base64url auth token, mode `0600`. **Rotates on every
  app launch.**
- `~/.gh-projects/run/port` - the localhost port the loopback server listens on, mode
  `0600`.

Both are written **only after** the HTTP server's `listen()` succeeds, `token` first
then `port` last - so a reader never sees a `port` that isn't accepting yet. The shim
re-reads these on **every** connect attempt, which is how it heals app restarts and
token rotation. The token is a secret and is never logged.

---

## B. Skill install / discovery

The tools being registered makes them *available* to Copilot; the **skill** is what
teaches Copilot *when and how* to use them. The skill lives in this repo at:

```
.github/skills/gh-projects/SKILL.md
```

Copilot discovers skills two ways:

- **Repo-local** - when you run Copilot in a checkout of this repo, the
  `.github/skills/gh-projects/` skill is discovered automatically.
- **User-global** - to make the skill available in *any* session (not just this repo),
  copy the skill into your personal skills directory. This form is safe to re-run to
  update in place (it won't create a nested `gh-projects/gh-projects/`):

  ```bash
  mkdir -p ~/.copilot/skills/gh-projects
  cp -R .github/skills/gh-projects/. ~/.copilot/skills/gh-projects/
  ```

Note: keep the skill's frontmatter `description:` on a single line. Every skill the
Copilot CLI loads here uses a single-line description, and multi-line YAML block scalars
(`>-`) may be ignored - so a single line is the safe, compatible shape.

After installing (or updating) the skill, **start a fresh Copilot session** so it picks
up the change. Skill discovery happens in the Copilot CLI (it scans the skills directory
when a session's CLI process starts and caches the result) - this is separate from the
GH Projects app, which owns the MCP server described above.

---

## When the app isn't running

The shim degrades gracefully (`src/main/mcp-server/shim/proxy.ts`):

- `tools/list` **always** returns the static, bundled tool manifest - so the advertised
  surface is stable and never empty, even with the app down.
- `tools/call` forwards to the loopback server, re-reading the run files and retrying
  once on a transient failure. If it still can't reach the app, it returns a clean
  **"The GH Projects app isn't running..."** error result and **never hangs**.
- On app **quit**, the run files are removed but the `~/.mcp.json` entry is **left in
  place** (quit is not the same as disable). The next launch republishes the run files;
  meanwhile the shim just reports "app not running".

---

## Confirming it's up (manual smoke check)

There's no automated end-to-end harness for a live Copilot session, so verify by hand:

1. **Build the shim:** `bun run build` (runs `build:shim`, producing
   `build/mcp-shim.cjs`).
2. **Launch GH Projects.**
3. **Check registration:** `~/.mcp.json` contains a `gh-projects` entry whose `env` has
   `GH_PROJECTS_MCP_MANAGED=1`.

   ```bash
   cat ~/.mcp.json
   ```
4. **Check the server is listening:** the port file exists while the app runs.

   ```bash
   cat ~/.gh-projects/run/port    # a port number
   ```
5. **Call `ping`** from a Copilot session (with the `gh-projects` MCP server
   configured). It should return `pong`.

---

## Troubleshooting

- **No `gh-projects` entry appears in `~/.mcp.json`.** Either the server is disabled,
  or you're in a dev checkout and haven't built the shim yet - run `bun run build` and
  relaunch. Check the app logs for a "shim bundle missing" warning.
- **A `gh-projects` entry exists but tools fail with "app isn't running".** The app is
  closed, or the run files are stale. Launch the app; the shim re-reads
  `~/.gh-projects/run/{port,token}` on the next call.
- **The app won't touch my `gh-projects` entry.** If you hand-added a `gh-projects`
  entry without the `GH_PROJECTS_MCP_MANAGED=1` marker, the app intentionally leaves it
  alone. Remove your unmarked entry (or add the marker) if you want the app to manage
  it.
- **Copilot has the tools but doesn't use them well.** The tools are registered but the
  skill isn't discovered. Confirm you're in this repo, or copy the skill into
  `~/.copilot/skills/gh-projects/`, then start a fresh session.
