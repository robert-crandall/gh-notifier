import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { startMcpServer, type McpServerHandle } from './server'
import { readRunFiles } from './runfiles'
import {
  LIST_PROJECTS_TOOL_NAME,
  GET_PROJECT_CONTEXT_TOOL_NAME,
  GET_REENTRY_DIGEST_TOOL_NAME,
} from './tool-manifest'

// The read-context tools reach the DB layer (and, through it, electron). Mock electron so
// `runMigrations` resolves its dir, and mock the DB singleton so the in-process server's handlers
// read from a real in-memory SQLite we seed and control.
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))
vi.mock('../db/index', () => ({ getDb: vi.fn() }))

import { getDb } from '../db/index'
import { runMigrations } from '../db/migrate'
import { createProject, createTodo } from '../db/projects'
import { upsertProjectCard, createResource, getProjectCardReadOnly } from '../context/registry'
import { getDigest } from '../digest'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

let db: BunDb

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString()
}

beforeEach(() => {
  db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)
})

async function startServer(): Promise<{ handle: McpServerHandle; token: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'gh-mcp-read-'))
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
  const client = new Client({ name: 'read-context-integration', version: '1.0.0' }, { capabilities: {} })
  cleanups.push(async () => {
    await client.close()
  })
  return client.connect(transport).then(() => client)
}

interface ProjectContextPayload {
  project: { id: number; name: string }
  card: { purpose: string; services: string[]; glossary: Record<string, string> }
  openTodos: { text: string }[]
  openTodoCount: number
  resources: { title: string }[]
  resourceCount: number
}

describe('read-context tools over the real loopback server', () => {
  it('advertises all three read tools in tools/list', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining([
        LIST_PROJECTS_TOOL_NAME,
        GET_PROJECT_CONTEXT_TOOL_NAME,
        GET_REENTRY_DIGEST_TOOL_NAME,
      ])
    )
  })

  it('list_projects returns the seeded roster with open-todo counts', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)

    const p = createProject('Widgets')
    createTodo(p.id, 'open one')

    const result = (await client.callTool({ name: LIST_PROJECTS_TOOL_NAME })) as CallToolResult
    expect(result.isError).toBeFalsy()
    const projects = (result.structuredContent as { projects: { id: number; name: string; activeTodoCount: number }[] })
      .projects
    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({ id: p.id, name: 'Widgets', activeTodoCount: 1 })
  })

  it('get_project_context returns context equal to what the app computes', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)

    const p = createProject('Payments')
    upsertProjectCard(p.id, {
      purpose: 'Own billing',
      services: ['billing-api'],
      glossary: { MRR: 'Monthly recurring revenue' },
    })
    createTodo(p.id, 'wire the webhook')
    createResource(p.id, { title: 'Latency board', kind: 'dashboard', source: 'datadog' })

    const result = (await client.callTool({
      name: GET_PROJECT_CONTEXT_TOOL_NAME,
      arguments: { project: 'Payments' },
    })) as CallToolResult
    expect(result.isError).toBeFalsy()

    const ctx = result.structuredContent as unknown as ProjectContextPayload
    const appCard = getProjectCardReadOnly(p.id)
    expect(ctx.project).toMatchObject({ id: p.id, name: 'Payments' })
    expect(ctx.card.purpose).toBe(appCard.purpose)
    expect(ctx.card.services).toEqual(appCard.services)
    expect(ctx.card.glossary).toEqual(appCard.glossary)
    expect(ctx.openTodos.map((t) => t.text)).toEqual(['wire the webhook'])
    expect(ctx.openTodoCount).toBe(1)
    expect(ctx.resources.map((r) => r.title)).toEqual(['Latency board'])
    expect(ctx.resourceCount).toBe(1)
  })

  it('get_reentry_digest returns items equal to the app-computed digest', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)

    const p = createProject('Backend')
    db.prepare('UPDATE projects SET created_at = ?, last_focused_at = ? WHERE id = ?').run(
      isoDaysAgo(60),
      isoDaysAgo(5),
      p.id
    )
    db.prepare(
      `INSERT INTO copilot_sessions (id, project_id, source, status, title, started_at, updated_at, linked_pr_url)
       VALUES ('s1', ?, 'github', 'pr_ready', 'ship it', ?, ?, 'https://x/pull/9')`
    ).run(p.id, isoDaysAgo(2), isoDaysAgo(1))

    const result = (await client.callTool({
      name: GET_REENTRY_DIGEST_TOOL_NAME,
      arguments: { project: p.id },
    })) as CallToolResult
    expect(result.isError).toBeFalsy()

    const appDigest = getDigest(p.id)
    const digest = result.structuredContent as unknown as {
      projectId: number
      items: { kind: string }[]
    }
    expect(digest.projectId).toBe(p.id)
    expect(digest.items.map((i) => i.kind)).toEqual(appDigest.items.map((i) => i.kind))
    expect(digest.items.length).toBeGreaterThan(0)
  })

  it('an unknown project yields an isError result (not a transport failure)', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)
    const result = (await client.callTool({
      name: GET_PROJECT_CONTEXT_TOOL_NAME,
      arguments: { project: 'does-not-exist' },
    })) as CallToolResult
    expect(result.isError).toBe(true)
  })
})
