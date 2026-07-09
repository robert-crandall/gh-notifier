import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { startMcpServer, type McpServerHandle } from '../server'
import { PING_TOOL_NAME } from '../tool-manifest'

/**
 * Electron-as-Node packaging proof. This exercises the EXACT prod spawn strategy
 * the generated `~/.mcp.json` uses — `process.execPath` (the Electron binary) with
 * `ELECTRON_RUN_AS_NODE=1` running the bundled, self-contained shim — driven by a
 * real stdio MCP client, against a real loopback server. It stops short only of
 * the real Copilot host doing the spawning.
 *
 * Skipped when the Electron binary isn't present (keeps CI green). Set
 * `MCP_SHIM_E2E_REQUIRE=1` to turn "skip" into a hard failure (release gate) so
 * the most important proof can't silently rot.
 */

const REPO_ROOT = process.cwd()
const REQUIRE_E2E = process.env.MCP_SHIM_E2E_REQUIRE === '1'

/** Resolve the installed Electron binary, or null when it isn't downloaded. */
function electronBinary(): string | null {
  const pkgDir = join(REPO_ROOT, 'node_modules', 'electron')
  const pathTxt = join(pkgDir, 'path.txt')
  if (!existsSync(pathTxt)) return null
  const bin = join(pkgDir, 'dist', readFileSync(pathTxt, 'utf8').trim())
  return existsSync(bin) ? bin : null
}

/** Bun binary to build the shim with (this suite runs under Bun). */
function bunBinary(): string | null {
  return process.versions.bun !== undefined ? process.execPath : null
}

const electron = electronBinary()
const bun = bunBinary()
const canRun = electron !== null && bun !== null

if (!canRun && REQUIRE_E2E) {
  throw new Error(
    `MCP_SHIM_E2E_REQUIRE=1 but cannot run e2e (electron=${electron !== null}, bun=${bun !== null})`
  )
}

const describeMaybe = canRun ? describe : describe.skip

describeMaybe('shim e2e (Electron-as-Node → loopback)', () => {
  let buildDir: string
  let shimBundle: string

  beforeAll(() => {
    buildDir = mkdtempSync(join(tmpdir(), 'gh-mcp-e2e-build-'))
    shimBundle = join(buildDir, 'mcp-shim.cjs')
    // Build the self-contained shim exactly like `bun run build:shim`.
    execFileSync(
      bun as string,
      [
        'build',
        join(REPO_ROOT, 'src', 'main', 'mcp-server', 'shim', 'entry.ts'),
        '--target=node',
        '--format=cjs',
        `--outfile=${shimBundle}`,
      ],
      { cwd: REPO_ROOT, stdio: 'pipe' }
    )
    expect(existsSync(shimBundle)).toBe(true)
  }, 60_000)

  afterAll(() => {
    rmSync(buildDir, { recursive: true, force: true })
  })

  /** Spawn the shim via Electron-as-Node against the given run dir. */
  async function connectShim(runDir: string): Promise<Client> {
    const transport = new StdioClientTransport({
      command: electron as string,
      args: [shimBundle],
      env: { ...getDefaultEnvironment(), ELECTRON_RUN_AS_NODE: '1', GH_PROJECTS_RUN_DIR: runDir },
      stderr: 'inherit',
    })
    const client = new Client({ name: 'e2e', version: '1.0.0' }, { capabilities: {} })
    await client.connect(transport)
    return client
  }

  it('lists + calls ping through the shim to a live loopback server', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'gh-mcp-e2e-run-'))
    let server: McpServerHandle | null = null
    let client: Client | null = null
    try {
      server = await startMcpServer({ runDir })
      client = await connectShim(runDir)

      // initialize advertised tool capability
      expect(client.getServerCapabilities()?.tools).toBeDefined()

      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name)).toContain(PING_TOOL_NAME)

      const result = (await client.callTool({ name: PING_TOOL_NAME })) as CallToolResult
      expect(result.content).toEqual([{ type: 'text', text: 'pong' }])
    } finally {
      if (client !== null) await client.close()
      if (server !== null) await server.close()
      rmSync(runDir, { recursive: true, force: true })
    }
  }, 30_000)

  it('with the app DOWN: still lists ping and returns a clean call error', async () => {
    // Empty run dir → no server running.
    const runDir = mkdtempSync(join(tmpdir(), 'gh-mcp-e2e-down-'))
    let client: Client | null = null
    try {
      client = await connectShim(runDir)

      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name)).toContain(PING_TOOL_NAME) // static, never empty

      const result = (await client.callTool({ name: PING_TOOL_NAME })) as CallToolResult
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toMatch(/isn't running/)
    } finally {
      if (client !== null) await client.close()
      rmSync(runDir, { recursive: true, force: true })
    }
  }, 30_000)
})
