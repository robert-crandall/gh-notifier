/**
 * Lifecycle glue between `main/index.ts` and the inbound MCP server. Owns the
 * single running server handle and the `~/.mcp.json` registration.
 *
 * - `enableMcpServer()`  — start the loopback server + register the shim in mcp.json.
 * - `disableMcpServer()` — stop the server + remove our mcp.json entry.
 * - `shutdownMcpServer()`— stop the server (deletes run files) but LEAVE mcp.json,
 *   because app quit != user disable; the shim degrades gracefully when the run
 *   files are gone.
 *
 * The shim command points at the Electron binary running as Node
 * (`ELECTRON_RUN_AS_NODE=1`) against the UNPACKED, self-contained `mcp-shim.cjs`
 * — no dependency on a system node/bun and no asar-script-execution.
 */

import { app, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadToken } from '../auth/storage'
import { startMcpServer, type McpServerHandle } from './server'
import {
  disableMcpJsonEntry,
  enableMcpJsonEntry,
  MANAGED_MARKER_ENV,
  MANAGED_MARKER_VALUE,
  type ShimCommand,
} from './mcp-json'
import { cleanupRunFiles } from './runfiles'

let handle: McpServerHandle | null = null

/**
 * Serializes lifecycle transitions so concurrent enable/disable/shutdown calls
 * (app-ready start racing an IPC toggle racing quit) can never overlap — which
 * would otherwise start two servers, disable during an in-flight start, or write
 * stale run files as the process exits. Each op runs strictly after the previous
 * one settles; a failed op never poisons the chain.
 */
let chain: Promise<void> = Promise.resolve()

function serialize(op: () => Promise<void>): Promise<void> {
  const run = chain.then(op, op)
  chain = run.then(
    () => {},
    () => {}
  )
  return run
}

/** Absolute path to the shipped, self-contained shim bundle. */
export function shimPath(): string {
  // Packaged: extraResource at Contents/Resources/mcp-shim.cjs.
  // Dev: the `build:shim` output under the repo root.
  return app.isPackaged
    ? join(process.resourcesPath, 'mcp-shim.cjs')
    : join(app.getAppPath(), 'build', 'mcp-shim.cjs')
}

/** The `~/.mcp.json` command that spawns the shim via Electron-as-Node. */
export function buildShimCommand(): ShimCommand {
  return {
    command: process.execPath,
    args: [shimPath()],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      [MANAGED_MARKER_ENV]: MANAGED_MARKER_VALUE,
    },
  }
}

/** Extra secrets to scrub from tool output beyond the rotating token (the PAT). */
function extraSecrets(): readonly string[] {
  const pat = loadToken()
  return pat !== null && pat.length > 0 ? [pat] : []
}

/**
 * Push a `todos:updated` (+ `projects:updated` for rail counts) event to every renderer when
 * the `add_todo` tool changes a todo, so open todo surfaces reload live. Kept here (not in the
 * tool) so the tool stays free of Electron/UI concerns.
 */
function broadcastTodoChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('todos:updated')
    win.webContents.send('projects:updated')
  }
}

/** Start the loopback server (if not already running) and register the shim. */
export function enableMcpServer(): Promise<void> {
  return serialize(async () => {
    if (handle === null) {
      handle = await startMcpServer({ extraSecrets, onTodoChanged: broadcastTodoChanged })
    }
    // Only register in ~/.mcp.json when the shim bundle actually exists, so we
    // never point Copilot at a missing command (e.g. in dev before build:shim).
    const path = shimPath()
    if (!existsSync(path)) {
      console.warn(`[mcp] shim bundle missing at ${path}; skipping ~/.mcp.json registration`)
      return
    }
    try {
      enableMcpJsonEntry(buildShimCommand())
    } catch (err) {
      // A corrupt ~/.mcp.json must not take down app startup.
      console.error('[mcp] failed to register shim in ~/.mcp.json:', err instanceof Error ? err.message : 'error')
    }
  })
}

/** Stop the server and remove our mcp.json entry (explicit user disable). */
export function disableMcpServer(): Promise<void> {
  return serialize(async () => {
    if (handle !== null) {
      await handle.close()
      handle = null
    } else {
      cleanupRunFiles()
    }
    try {
      disableMcpJsonEntry()
    } catch (err) {
      console.error('[mcp] failed to remove shim from ~/.mcp.json:', err instanceof Error ? err.message : 'error')
    }
  })
}

/** Stop the server on app quit. Leaves the mcp.json entry in place. */
export function shutdownMcpServer(): Promise<void> {
  return serialize(async () => {
    if (handle !== null) {
      await handle.close()
      handle = null
    } else {
      cleanupRunFiles()
    }
  })
}

/** Test/inspection helper: is the loopback server currently running? */
export function isMcpServerRunning(): boolean {
  return handle !== null
}
