/**
 * Real SSO-gated MCP verification harness (issue #77 item 3).
 *
 * Drives the app's OWN MCP client code path — `listMcpTools` + `createMcpRunner`
 * from src/main/context/mcp-client.ts, plus the real config/tool validation from
 * mcp-config.ts — against a real MCP server config the owner supplies. It does a
 * `listTools` handshake and ONE tool read, then prints the live value and its
 * provenance (ok / failure class). No Electron, no GUI: this is the ~2-minute
 * owner task that proves a live SSO-gated value can be pulled end-to-end.
 *
 * The printed `value` is produced ONLY by the app-owned MCP read (createMcpRunner)
 * — never self-reported — so a green run genuinely proves the server answered.
 *
 * Usage:
 *   bun --bun run scripts/verify-mcp.ts <server-config.json> [toolName] [toolArgsJson] [--full]
 *
 * By default the live value is previewed (first 200 chars) so sensitive output
 * doesn't dump into terminal/CI history; pass --full to print the whole value.
 *
 * <server-config.json> is a JSON object:
 *   {
 *     "label":   "datadog",
 *     "command": "npx",
 *     "args":    ["-y", "@datadog/mcp-server"],
 *     "env":     { "DD_API_KEY": "…", "DD_APP_KEY": "…" },
 *     "tool":    "search_logs",            // optional; or pass as argv[2]
 *     "toolArgs": { "query": "service:web" } // optional; or pass JSON as argv[3]
 *   }
 * Secrets live only in that local file / the owner's env — nothing is committed.
 */
import { readFileSync } from 'fs'
import { listMcpTools, createMcpRunner } from '../src/main/context/mcp-client'
import { validateMcpServerInput, validateToolName, validateToolArgs } from '../src/main/context/mcp-config'

function die(message: string): never {
  console.error(`[verify-mcp] ${message}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const full = argv.includes('--full')
  const [configPath, toolArg, toolArgsArg] = argv.filter((a) => a !== '--full')
  if (configPath === undefined) {
    die('usage: bun --bun run scripts/verify-mcp.ts <server-config.json> [toolName] [toolArgsJson] [--full]')
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (err) {
    die(`could not read/parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`)
  }
  // Guard the shape before treating it as a config object, so a file containing
  // null / an array / a primitive gives a clear message instead of a raw TypeError.
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    die(`${configPath} must contain a JSON object with a "command" (plus optional args, env, tool, toolArgs)`)
  }
  const file = raw as Record<string, unknown>

  // Reuse the app's REAL config validation so this exercises the same seam the app does.
  const validated = validateMcpServerInput(file.label ?? 'verify-mcp', file)
  if (!validated.ok) die(`invalid server config: ${validated.error}`)
  const server = validated.value.config

  const toolNameRaw = toolArg ?? file.tool
  const toolName = validateToolName(toolNameRaw)
  if (!toolName.ok) die(`invalid/missing tool name: ${toolName.error} (pass as argv[2] or "tool" in the config)`)

  let toolArgsRaw: unknown = file.toolArgs ?? {}
  if (toolArgsArg !== undefined) {
    try {
      toolArgsRaw = JSON.parse(toolArgsArg)
    } catch (err) {
      die(`toolArgsJson is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const toolArgs = validateToolArgs(toolArgsRaw)
  if (!toolArgs.ok) die(`invalid tool args: ${toolArgs.error}`)

  // ── 1. Handshake: does the server start + list tools? ───────────────────────
  // Log only the command + arg count — args can carry credentials (e.g. a token),
  // which shouldn't leak into terminal history / CI logs.
  console.log(`[verify-mcp] connecting to "${server.command}" (${server.args.length} arg(s)) and listing tools…`)
  const tools = await listMcpTools(server)
  if (!tools.ok) {
    // A handshake failure is an infra/auth/timeout problem, not bad CLI input, so
    // it exits 2 (runtime failure) — not 1 (which is reserved for bad input).
    console.error(`[verify-mcp] ❌ listTools failed (server didn't start / auth / timeout): ${tools.error}`)
    process.exit(2)
  }
  console.log(`[verify-mcp] handshake OK: ${tools.tools.length} tool(s) advertised`)
  const found = tools.tools.some((t) => t.name === toolName.value)
  console.log(
    `[verify-mcp] target tool "${toolName.value}" ${found ? 'is advertised' : 'NOT in the advertised list (attempting anyway)'}`
  )

  // ── 2. Real read: the app-owned MCP client pulls a live value ───────────────
  // Tool args can carry sensitive values (tokens, ids, filters), so log only the
  // arg key count by default; --full prints the actual args.
  const argKeys = Object.keys(toolArgs.value)
  const argsLabel = full ? JSON.stringify(toolArgs.value) : `${argKeys.length} arg(s): ${argKeys.join(', ')}`
  console.log(`[verify-mcp] calling ${toolName.value}(${argsLabel})…`)
  const result = await createMcpRunner().run(server, toolName.value, toolArgs.value)

  console.log('\n[verify-mcp] ── result (app-owned; produced only by createMcpRunner) ──')
  console.log(`  ok:       ${result.ok}`)
  console.log(`  failure:  ${result.failure ?? '(none)'}`)
  console.log(`  reason:   ${result.reason ?? '(none)'}`)
  // The tool value can contain sensitive data (logs, account info). Show only a
  // short preview by default so it doesn't dump into terminal history / CI logs;
  // pass --full to print the whole value.
  if (result.ok) {
    const serialized = JSON.stringify(result.value)
    const PREVIEW = 200
    const shown = full || serialized.length <= PREVIEW ? serialized : `${serialized.slice(0, PREVIEW)}… (${serialized.length} chars; pass --full to show all)`
    console.log(`  value:    ${shown}`)
  } else {
    console.log('  value:    (no value)')
  }

  if (result.ok) {
    console.log('\n[verify-mcp] ✅ live value pulled through the app’s real MCP client.')
    process.exit(0)
  }
  console.log(
    `\n[verify-mcp] ❌ no live value. failure="${result.failure}". ` +
      '(auth_missing/connector_down/timeout = infra/creds; query_invalid/no_data = the tool/args.)'
  )
  process.exit(2)
}

main().catch((err: unknown) => {
  // Exit-code scheme: 0 = live value pulled, 1 = bad input/usage (via die), 2 =
  // runtime failure (handshake/read). An unexpected throw here is a runtime
  // failure, not bad input, so it exits 2 - not 1.
  console.error('[verify-mcp] unexpected error:', err instanceof Error ? err.message : err)
  process.exit(2)
})
