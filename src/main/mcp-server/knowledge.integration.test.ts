import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { startMcpServer, type McpServerHandle } from './server'
import { readRunFiles } from './runfiles'
import { READ_SERVICE_KNOWLEDGE_TOOL_NAME, WRITE_SERVICE_KNOWLEDGE_TOOL_NAME } from './tool-manifest'

// The knowledge read tool reaches the DB layer (for linked resources), so mock
// electron + the DB singleton exactly like the add_todo integration test does.
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))
vi.mock('../db/index', () => ({ getDb: vi.fn() }))

import { getDb } from '../db/index'
import { runMigrations } from '../db/migrate'
import { createProject } from '../db/projects'
import { createResource } from '../context/registry'

/**
 * Stand up the REAL loopback MCP server + a REAL SDK client and drive the
 * service-knowledge tools end to end. Uses an isolated temp knowledge dir (via
 * GH_PROJECTS_KNOWLEDGE_DIR) so the developer's real ~/.gh-projects is untouched.
 */

const cleanups: Array<() => Promise<void> | void> = []
let knowledgeDir = ''
let prevKnowledgeEnv: string | undefined

afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
  if (prevKnowledgeEnv === undefined) delete process.env.GH_PROJECTS_KNOWLEDGE_DIR
  else process.env.GH_PROJECTS_KNOWLEDGE_DIR = prevKnowledgeEnv
})

beforeEach(() => {
  const db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)

  prevKnowledgeEnv = process.env.GH_PROJECTS_KNOWLEDGE_DIR
  knowledgeDir = mkdtempSync(join(tmpdir(), 'gh-knowledge-int-'))
  process.env.GH_PROJECTS_KNOWLEDGE_DIR = knowledgeDir
  cleanups.push(() => rmSync(knowledgeDir, { recursive: true, force: true }))
})

async function startServer(): Promise<{ handle: McpServerHandle; token: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'gh-mcp-srv-'))
  const handle = await startMcpServer({ runDir: dir })
  cleanups.push(async () => {
    await handle.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const endpoint = readRunFiles(dir)
  if (endpoint === null) throw new Error('run files were not published')
  return { handle, token: endpoint.token }
}

function connectClient(port: number, token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  const client = new Client({ name: 'knowledge-int-test', version: '1.0.0' }, { capabilities: {} })
  cleanups.push(async () => {
    await client.close()
  })
  return client.connect(transport).then(() => client)
}

function textOf(result: CallToolResult): string {
  return result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
}

function callRead(client: Client, args: Record<string, unknown>): Promise<CallToolResult> {
  return client.callTool({ name: READ_SERVICE_KNOWLEDGE_TOOL_NAME, arguments: args }) as Promise<CallToolResult>
}
function callWrite(client: Client, args: Record<string, unknown>): Promise<CallToolResult> {
  return client.callTool({ name: WRITE_SERVICE_KNOWLEDGE_TOOL_NAME, arguments: args }) as Promise<CallToolResult>
}

describe('service-knowledge tools over the real loopback server', () => {
  it('advertises both knowledge tools in tools/list', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    expect(names).toContain(READ_SERVICE_KNOWLEDGE_TOOL_NAME)
    expect(names).toContain(WRITE_SERVICE_KNOWLEDGE_TOOL_NAME)
  })

  it('writes a runbook and reads it back (stamped source: copilot)', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)

    const write = await callWrite(client, { service: 'web', markdown: '# Health\n\nHit /health and check 200.' })
    expect(write.isError).toBeFalsy()
    expect(textOf(write)).toMatch(/Wrote the runbook for service "web"/)

    const read = await callRead(client, { service: 'web' })
    expect(read.isError).toBeFalsy()
    const body = textOf(read)
    expect(body).toContain('Hit /health and check 200.')
    expect(body).toContain('source: copilot')
  })

  it('sees a human edit made directly on disk (the core acceptance test)', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)

    await callWrite(client, { service: 'payments', markdown: 'original runbook' })

    // Simulate the human opening the file and editing it by hand.
    const filePath = join(knowledgeDir, 'payments.md')
    const current = readFileSync(filePath, 'utf8')
    writeFileSync(filePath, `${current}\n\n## Oncall\nPage the on-call engineer.\n`)

    const read = await callRead(client, { service: 'payments' })
    expect(textOf(read)).toContain('Page the on-call engineer.')
  })

  it('returns a friendly note (not an error) when no runbook exists yet', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)
    const read = await callRead(client, { service: 'ghost' })
    expect(read.isError).toBeFalsy()
    expect(textOf(read)).toMatch(/No runbook yet/)
  })

  it('rejects a path-traversal service name on write and read (SECURITY)', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)

    const write = await callWrite(client, { service: '../escape', markdown: 'pwned' })
    expect(write.isError).toBe(true)
    expect(textOf(write)).toMatch(/Invalid service name/)

    const read = await callRead(client, { service: '../../etc/passwd' })
    expect(read.isError).toBe(true)
  })

  it('optionally lists linked resources with their project (no cross-project conflation)', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)

    const project = createProject('Storefront')
    createResource(project.id, {
      title: 'Prod latency dashboard',
      kind: 'dashboard',
      source: 'datadog',
      service: 'web',
      url: 'https://app.datadoghq.com/dashboard/web-latency',
      aliases: ['prod latency dashboard'],
    })
    await callWrite(client, { service: 'web', markdown: 'See [prod latency dashboard].' })

    const read = await callRead(client, { service: 'web', includeResources: true })
    const body = textOf(read)
    expect(body).toContain('Prod latency dashboard')
    expect(body).toContain('Storefront') // project context is shown
    expect(body).toContain('https://app.datadoghq.com/dashboard/web-latency')
  })
})
