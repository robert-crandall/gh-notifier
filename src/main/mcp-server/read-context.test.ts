import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))

vi.mock('../db/index', () => ({ getDb: vi.fn() }))

import { getDb } from '../db/index'
import { runMigrations } from '../db/migrate'
import { createProject, createTodo, updateTodo, addAgentTodo, createLink } from '../db/projects'
import { upsertProjectCard, createResource } from '../context/registry'
import { runListProjects, runGetProjectContext, runGetReentryDigest } from './read-context'
import { buildToolHandlers } from './tools'
import {
  TOOL_MANIFEST,
  ADD_TODO_TOOL_NAME,
  LIST_PROJECTS_TOOL_NAME,
  GET_PROJECT_CONTEXT_TOOL_NAME,
  GET_REENTRY_DIGEST_TOOL_NAME,
  findManifestTool,
} from './tool-manifest'

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

// ── Payload shapes (test-local; the DTOs are main-only) ───────────────────────

interface ListProjectsPayload {
  projects: { id: number; name: string; status: string; nextAction: string; activeTodoCount: number }[]
}
interface ProjectContextPayload {
  project: {
    id: number
    name: string
    status: string
    nextAction: string
    driftState: string
    activeTodoCount: number
    unreadCount: number
    updatedAt: string
  }
  card: {
    purpose: string
    repos: string[]
    services: string[]
    activeGoal: string
    glossary: Record<string, string>
    updatedAt: string
  }
  openTodos: {
    id: number
    title: string | null
    text: string
    sourceUrl: string | null
    suggestedAction: unknown
    origin: string
    body: string | null
    bodyTruncated: boolean
  }[]
  openTodoCount: number
  openTodosTruncated: boolean
  links: { id: number; label: string; url: string }[]
  linkCount: number
  linksTruncated: boolean
  resources: {
    id: number
    title: string
    kind: string
    source: string
    service: string
    env: string
    url: string | null
    description: string
    descriptionTruncated: boolean
  }[]
  resourceCount: number
  resourcesTruncated: boolean
}
interface DigestItemLite {
  kind: string
}
interface DigestSinglePayload {
  projectId: number
  name: string
  driftState: string
  asOf: string
  items: DigestItemLite[]
}
interface DigestGlobalPayload {
  projects: { projectId: number; name: string; driftState: string; asOf: string; items: DigestItemLite[] }[]
}

function payload<T>(result: CallToolResult): T {
  return result.structuredContent as unknown as T
}

function totalChanges(): number {
  return (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n
}

// ── list_projects ─────────────────────────────────────────────────────────────

describe('runListProjects', () => {
  it('returns an empty roster when there are no projects', () => {
    const result = runListProjects()
    expect(result.isError).toBeUndefined()
    expect(payload<ListProjectsPayload>(result).projects).toEqual([])
  })

  it('returns a lean row per project with the open-todo count', () => {
    const alpha = createProject('Alpha')
    createProject('Beta')
    createTodo(alpha.id, 'open one')
    createTodo(alpha.id, 'open two')
    const done = createTodo(alpha.id, 'closed')
    updateTodo(done.id, { done: true })

    const { projects } = payload<ListProjectsPayload>(runListProjects())
    expect(projects.map((p) => p.name)).toEqual(['Alpha', 'Beta'])
    const alphaRow = projects.find((p) => p.name === 'Alpha')
    expect(alphaRow).toMatchObject({ id: alpha.id, status: 'active', activeTodoCount: 2 })
    expect(projects.find((p) => p.name === 'Beta')?.activeTodoCount).toBe(0)
  })

  it('exposes only the five spec fields (lean payload)', () => {
    createProject('Solo')
    const { projects } = payload<ListProjectsPayload>(runListProjects())
    expect(Object.keys(projects[0]).sort()).toEqual(
      ['activeTodoCount', 'id', 'name', 'nextAction', 'status'].sort()
    )
  })

  it('does not write to the database', () => {
    createProject('Alpha')
    const before = totalChanges()
    runListProjects()
    expect(totalChanges()).toBe(before)
  })
})

// ── get_project_context ────────────────────────────────────────────────────────

describe('runGetProjectContext — resolution', () => {
  it('errors on an unknown project name', () => {
    const result = runGetProjectContext({ project: 'Ghost' })
    expect(result.isError).toBe(true)
  })

  it('errors on an unknown project id', () => {
    const result = runGetProjectContext({ project: 999 })
    expect(result.isError).toBe(true)
  })

  it('errors on a non-integer / non-positive id', () => {
    expect(runGetProjectContext({ project: 1.5 }).isError).toBe(true)
    expect(runGetProjectContext({ project: 0 }).isError).toBe(true)
    expect(runGetProjectContext({ project: -3 }).isError).toBe(true)
  })

  it('errors on a missing / empty project arg', () => {
    expect(runGetProjectContext({}).isError).toBe(true)
    expect(runGetProjectContext({ project: '   ' }).isError).toBe(true)
  })

  it('resolves by exact name (case-insensitive) and by numeric id', () => {
    const p = createProject('Gamma')
    expect(payload<ProjectContextPayload>(runGetProjectContext({ project: 'gamma' })).project.id).toBe(p.id)
    expect(payload<ProjectContextPayload>(runGetProjectContext({ project: p.id })).project.id).toBe(p.id)
  })

  it('does not resolve a soft-deleted project', () => {
    const p = createProject('Deleted')
    db.prepare('UPDATE projects SET deleted_at = ? WHERE id = ?').run(isoDaysAgo(0), p.id)
    expect(runGetProjectContext({ project: p.id }).isError).toBe(true)
    expect(runGetProjectContext({ project: 'Deleted' }).isError).toBe(true)
  })
})

describe('runGetProjectContext — shape', () => {
  it('returns the card, open todos, links and resources', () => {
    const p = createProject('Payments')
    upsertProjectCard(p.id, {
      purpose: 'Own billing',
      repos: ['acme/pay'],
      services: ['billing-api', 'ledger'],
      activeGoal: 'Ship invoices',
      glossary: { MRR: 'Monthly recurring revenue' },
    })
    createTodo(p.id, 'open task')
    const done = createTodo(p.id, 'done task')
    updateTodo(done.id, { done: true })
    createLink(p.id, 'Runbook', 'https://example.com/runbook')
    createResource(p.id, { title: 'Latency board', kind: 'dashboard', source: 'datadog', service: 'billing-api' })

    const ctx = payload<ProjectContextPayload>(runGetProjectContext({ project: 'Payments' }))
    expect(ctx.project).toMatchObject({ id: p.id, name: 'Payments', status: 'active' })
    expect(ctx.card).toMatchObject({
      purpose: 'Own billing',
      repos: ['acme/pay'],
      services: ['billing-api', 'ledger'],
      activeGoal: 'Ship invoices',
      glossary: { MRR: 'Monthly recurring revenue' },
    })
    // Only the open todo is surfaced.
    expect(ctx.openTodos.map((t) => t.text)).toEqual(['open task'])
    expect(ctx.openTodoCount).toBe(1)
    expect(ctx.openTodosTruncated).toBe(false)
    expect(ctx.links).toEqual([{ id: expect.any(Number), label: 'Runbook', url: 'https://example.com/runbook' }])
    expect(ctx.resources).toHaveLength(1)
    expect(ctx.resources[0]).toMatchObject({ title: 'Latency board', kind: 'dashboard', source: 'datadog' })
  })

  it('does not leak internal todo fields (idempotencyKey, sortOrder, done)', () => {
    const p = createProject('Lean')
    createTodo(p.id, 'a todo')
    const ctx = payload<ProjectContextPayload>(runGetProjectContext({ project: p.id }))
    expect(Object.keys(ctx.openTodos[0]).sort()).toEqual(
      ['body', 'bodyTruncated', 'id', 'origin', 'sourceUrl', 'suggestedAction', 'text', 'title'].sort()
    )
  })

  it('caps the open-todo, link and resource lists and flags truncation', () => {
    const p = createProject('Busy')
    for (let i = 0; i < 55; i++) createTodo(p.id, `todo ${i}`)
    for (let i = 0; i < 35; i++) createLink(p.id, `link ${i}`, `https://example.com/${i}`)
    for (let i = 0; i < 35; i++) createResource(p.id, { title: `res ${i}` })

    const ctx = payload<ProjectContextPayload>(runGetProjectContext({ project: p.id }))
    expect(ctx.openTodos).toHaveLength(50)
    expect(ctx.openTodoCount).toBe(55)
    expect(ctx.openTodosTruncated).toBe(true)
    expect(ctx.links).toHaveLength(30)
    expect(ctx.linkCount).toBe(35)
    expect(ctx.linksTruncated).toBe(true)
    expect(ctx.resources).toHaveLength(30)
    expect(ctx.resourceCount).toBe(35)
    expect(ctx.resourcesTruncated).toBe(true)
  })

  it('caps long todo body and resource description with a truncation flag', () => {
    const p = createProject('Verbose')
    addAgentTodo({
      resolvedProjectId: p.id,
      explicitPlacement: true,
      title: 'Big',
      body: 'x'.repeat(700),
      sourceUrl: null,
      suggestedAction: null,
      idempotencyKey: null,
    })
    createResource(p.id, { title: 'Doc', description: 'y'.repeat(400) })

    const ctx = payload<ProjectContextPayload>(runGetProjectContext({ project: p.id }))
    const todo = ctx.openTodos[0]
    expect(todo.bodyTruncated).toBe(true)
    expect((todo.body ?? '').length).toBeLessThanOrEqual(600)
    expect(ctx.resources[0].descriptionTruncated).toBe(true)
    expect(ctx.resources[0].description.length).toBeLessThanOrEqual(300)
  })

  it('does not write — including never creating a project_cards row', () => {
    const p = createProject('NoCard')
    const before = totalChanges()
    runGetProjectContext({ project: p.id })
    expect(totalChanges()).toBe(before)
    const cardRows = db
      .prepare('SELECT COUNT(*) AS n FROM project_cards WHERE project_id = ?')
      .get(p.id) as { n: number }
    expect(cardRows.n).toBe(0)
  })
})

// ── get_reentry_digest ─────────────────────────────────────────────────────────

/** Seed a project whose created_at is old (so a recent session clears the watermark). */
function seedProject(name: string, createdDaysAgo: number, lastFocusedDaysAgo: number | null): number {
  const p = createProject(name)
  db.prepare('UPDATE projects SET created_at = ?, last_focused_at = ? WHERE id = ?').run(
    isoDaysAgo(createdDaysAgo),
    lastFocusedDaysAgo === null ? null : isoDaysAgo(lastFocusedDaysAgo),
    p.id
  )
  return p.id
}

function seedRecentSession(projectId: number): void {
  db.prepare(
    `INSERT INTO copilot_sessions (id, project_id, source, status, title, started_at, updated_at, linked_pr_url)
     VALUES (?, ?, 'github', 'pr_ready', 'ship it', ?, ?, 'https://x/pull/1')`
  ).run(`s-${projectId}`, projectId, isoDaysAgo(2), isoDaysAgo(1))
}

describe('runGetReentryDigest — single project', () => {
  it('errors on an unknown project', () => {
    expect(runGetReentryDigest({ project: 'Nope' }).isError).toBe(true)
  })

  it('returns computed digest items and drift for a project with activity', () => {
    const id = seedProject('Active', 60, 5)
    seedRecentSession(id)
    const digest = payload<DigestSinglePayload>(runGetReentryDigest({ project: id }))
    expect(digest.projectId).toBe(id)
    expect(digest.name).toBe('Active')
    expect(digest.items.length).toBeGreaterThan(0)
    expect(digest.items[0].kind).toBe('agent-pr-ready')
    expect(typeof digest.asOf).toBe('string')
  })

  it('returns an empty item list for a quiet project', () => {
    const id = seedProject('Quiet', 1, 0)
    const digest = payload<DigestSinglePayload>(runGetReentryDigest({ project: id }))
    expect(digest.items).toEqual([])
  })

  it('does not write to the database', () => {
    const id = seedProject('Active', 60, 5)
    seedRecentSession(id)
    const before = totalChanges()
    runGetReentryDigest({ project: id })
    expect(totalChanges()).toBe(before)
  })
})

describe('runGetReentryDigest — all projects', () => {
  it('includes projects with activity OR drift, and omits quiet active projects', () => {
    const active = seedProject('Active', 60, 5) // has a recent session → included via items
    seedRecentSession(active)
    seedProject('Quiet', 1, 0) // active, no activity → excluded
    seedProject('Drifting', 10, 10) // no activity but stale → included via drift

    const { projects } = payload<DigestGlobalPayload>(runGetReentryDigest({}))
    const byName = new Map(projects.map((p) => [p.name, p]))
    expect(byName.has('Active')).toBe(true)
    expect(byName.has('Drifting')).toBe(true)
    expect(byName.has('Quiet')).toBe(false)
    expect(byName.get('Active')?.items.length).toBeGreaterThan(0)
    expect(byName.get('Drifting')?.driftState).toBe('drifting')
    expect(byName.get('Drifting')?.items).toEqual([])
  })

  it('returns an empty list when nothing has activity or drift', () => {
    seedProject('Quiet', 1, 0)
    expect(payload<DigestGlobalPayload>(runGetReentryDigest({})).projects).toEqual([])
  })

  it('does not write to the database', () => {
    const active = seedProject('Active', 60, 5)
    seedRecentSession(active)
    const before = totalChanges()
    runGetReentryDigest({})
    expect(totalChanges()).toBe(before)
  })
})

// ── Manifest / registry hygiene ────────────────────────────────────────────────

describe('read-context manifest wiring', () => {
  it('advertises all three tools with the documented input schemas', () => {
    for (const name of [LIST_PROJECTS_TOOL_NAME, GET_PROJECT_CONTEXT_TOOL_NAME, GET_REENTRY_DIGEST_TOOL_NAME]) {
      expect(findManifestTool(name)).toBeDefined()
    }
    const ctx = findManifestTool(GET_PROJECT_CONTEXT_TOOL_NAME)
    expect(ctx?.inputSchema.required).toEqual(['project'])
    expect(ctx?.inputSchema.additionalProperties).toBe(false)
    // get_reentry_digest's project is optional.
    const digest = findManifestTool(GET_REENTRY_DIGEST_TOOL_NAME)
    expect(digest?.inputSchema.required).toBeUndefined()
    // project accepts a name (string) or an id (integer), with bounds mirroring the handlers.
    const projectSchema = ctx?.inputSchema.properties?.project as {
      type?: unknown
      minLength?: unknown
      minimum?: unknown
    }
    expect(projectSchema.type).toEqual(['string', 'integer'])
    expect(projectSchema.minLength).toBe(1)
    expect(projectSchema.minimum).toBe(1)
  })

  it('has a handler registered for every advertised tool', () => {
    const handlers = buildToolHandlers({ getSecrets: () => [] })
    for (const tool of TOOL_MANIFEST) {
      expect(handlers.has(tool.name)).toBe(true)
    }
  })

  it('keeps add_todo name-only, so the roster must not promise ids to add_todo', () => {
    // The read tools accept a name OR an integer id, but add_todo resolves by name only.
    // Guard the contract list_projects documents: pass the NAME (not id) to add_todo.
    const addTodo = findManifestTool(ADD_TODO_TOOL_NAME)
    const projectSchema = addTodo?.inputSchema.properties?.project as { type?: unknown }
    expect(projectSchema.type).toBe('string')
  })
})
