import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))

vi.mock('../db', () => ({ getDb: vi.fn() }))

import { getDb } from '../db'
import { runMigrations } from '../db/migrate'
import {
  createResource,
  listResources,
  getResource,
  updateResource,
  deleteResource,
  restoreResource,
  markResourceUsed,
  markResourceSuspect,
  recordResolution,
  getProjectCard,
  upsertProjectCard,
  listMcpServers,
  getMcpServer,
  upsertMcpServer,
  deleteMcpServer,
} from './registry'

// ── Setup ─────────────────────────────────────────────────────────────────────

let db: BunDb

function seedProject(name = 'Alpha'): number {
  const row = db
    .query("INSERT INTO projects (name, sort_order) VALUES (?, 0) RETURNING id")
    .get(name) as { id: number }
  return row.id
}

beforeEach(() => {
  db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)
})

// ── createResource / defaults ─────────────────────────────────────────────────

describe('createResource', () => {
  it('creates a record with sensible defaults', () => {
    const pid = seedProject()
    const r = createResource(pid, { title: 'Mesh latency dashboard' })
    expect(r.title).toBe('Mesh latency dashboard')
    expect(r.kind).toBe('link')
    expect(r.source).toBe('generic')
    expect(r.provenance).toBe('manual')
    expect(r.confidence).toBeCloseTo(0.5)
    expect(r.suspect).toBe(false)
    expect(r.validationState).toBe('unverified')
    expect(r.aliases).toEqual([])
    expect(r.tags).toEqual({})
    expect(r.url).toBeNull()
  })

  it('round-trips arrays, maps, and executable metadata', () => {
    const pid = seedProject()
    const r = createResource(pid, {
      title: 'p99 latency',
      kind: 'metric_query',
      source: 'datadog',
      service: 'checkout',
      env: 'prod',
      tags: { cluster: 'us-east', system: 'payments' },
      aliases: ['mesh latency', 'p99'],
      url: 'https://example.test/dash',
      mcpServer: 'dd-1',
      toolName: 'query_metric',
      toolArgs: { metric: 'trace.http.request', agg: 'avg' },
      externalRef: 'dash-123',
      provenance: 'captured',
    })
    const fetched = getResource(r.id)
    expect(fetched).not.toBeNull()
    expect(fetched?.tags).toEqual({ cluster: 'us-east', system: 'payments' })
    expect(fetched?.aliases).toEqual(['mesh latency', 'p99'])
    expect(fetched?.toolArgs).toEqual({ metric: 'trace.http.request', agg: 'avg' })
    expect(fetched?.mcpServer).toBe('dd-1')
    expect(fetched?.externalRef).toBe('dash-123')
    expect(fetched?.provenance).toBe('captured')
  })

  it('rejects an empty title', () => {
    const pid = seedProject()
    expect(() => createResource(pid, { title: '   ' })).toThrow(/title is required/)
  })
})

// ── listResources / soft-delete ───────────────────────────────────────────────

describe('listResources', () => {
  it('lists only live records, scoped to the project', () => {
    const a = seedProject('A')
    const b = seedProject('B')
    createResource(a, { title: 'A1' })
    const a2 = createResource(a, { title: 'A2' })
    createResource(b, { title: 'B1' })

    expect(listResources(a).map((r) => r.title).sort()).toEqual(['A1', 'A2'])
    expect(listResources(b).map((r) => r.title)).toEqual(['B1'])

    deleteResource(a2.id)
    expect(listResources(a).map((r) => r.title)).toEqual(['A1'])
  })

  it('restore brings a soft-deleted record back', () => {
    const pid = seedProject()
    const r = createResource(pid, { title: 'Gone' })
    deleteResource(r.id)
    expect(getResource(r.id)).toBeNull()
    restoreResource(r.id)
    expect(getResource(r.id)?.title).toBe('Gone')
  })
})

// ── updateResource ────────────────────────────────────────────────────────────

describe('updateResource', () => {
  it('changes only supplied fields', () => {
    const pid = seedProject()
    const r = createResource(pid, { title: 'Old', service: 'svc', description: 'keep' })
    const updated = updateResource(r.id, { title: 'New', service: 'svc2' })
    expect(updated.title).toBe('New')
    expect(updated.service).toBe('svc2')
    expect(updated.description).toBe('keep')
  })

  it('can clear url and toolArgs by passing null', () => {
    const pid = seedProject()
    const r = createResource(pid, { title: 'X', url: 'https://x.test', toolArgs: { a: 1 } })
    const updated = updateResource(r.id, { url: null, toolArgs: null })
    expect(updated.url).toBeNull()
    expect(updated.toolArgs).toBeNull()
  })

  it('throws for a missing record', () => {
    expect(() => updateResource(9999, { title: 'Nope' })).toThrow(/not found/)
  })
})

// ── health mutators ───────────────────────────────────────────────────────────

describe('markResourceUsed', () => {
  it('bumps confidence, clears suspect, and sets valid when verified', () => {
    const pid = seedProject()
    const r = createResource(pid, { title: 'Q' })
    markResourceSuspect(r.id, 'invalid', 'ERR', 'boom')
    expect(getResource(r.id)?.suspect).toBe(true)

    markResourceUsed(r.id, true)
    const after = getResource(r.id)
    expect(after?.suspect).toBe(false)
    expect(after?.failureCount).toBe(0)
    expect(after?.validationState).toBe('valid')
    expect(after?.lastUsed).not.toBeNull()
    expect(after?.lastVerified).not.toBeNull()
    expect(after?.confidence ?? 0).toBeGreaterThan(0.3)
  })

  it('does not set lastVerified when not verified', () => {
    const pid = seedProject()
    const r = createResource(pid, { title: 'Q' })
    markResourceUsed(r.id, false)
    expect(getResource(r.id)?.lastVerified).toBeNull()
    expect(getResource(r.id)?.lastUsed).not.toBeNull()
  })

  it('an UNVERIFIED use does NOT heal a suspect record', () => {
    const pid = seedProject()
    const r = createResource(pid, { title: 'Q' })
    markResourceSuspect(r.id, 'invalid', 'ERR', 'boom')
    markResourceUsed(r.id, false) // cited but not actually read
    const after = getResource(r.id)
    expect(after?.suspect).toBe(true) // still suspect — never silently healed
    expect(after?.validationState).toBe('invalid')
    expect(after?.lastUsed).not.toBeNull()
  })
})

describe('markResourceSuspect', () => {
  it('sets suspect, increments failure_count, drops confidence, records error', () => {
    const pid = seedProject()
    const r = createResource(pid, { title: 'Bad' })
    markResourceSuspect(r.id, 'no_data', 'NO_DATA', 'empty result')
    const after = getResource(r.id)
    expect(after?.suspect).toBe(true)
    expect(after?.failureCount).toBe(1)
    expect(after?.validationState).toBe('no_data')
    expect(after?.lastErrorCode).toBe('NO_DATA')
    expect(after?.confidence ?? 1).toBeLessThan(0.5)
  })

  it('clamps confidence at zero across repeated failures', () => {
    const pid = seedProject()
    const r = createResource(pid, { title: 'Bad' })
    for (let i = 0; i < 10; i++) markResourceSuspect(r.id, 'invalid', null, null)
    expect(getResource(r.id)?.confidence).toBe(0)
  })
})

// ── resolution log ────────────────────────────────────────────────────────────

describe('recordResolution', () => {
  it('appends a row with a failure class', () => {
    const pid = seedProject()
    const r = createResource(pid, { title: 'Q' })
    recordResolution({
      projectId: pid,
      resourceId: r.id,
      question: 'how is latency?',
      verdict: 'confident',
      citedResourceId: r.id,
      answer: 'p99 240ms',
      failureClass: null,
    })
    const count = db
      .query('SELECT COUNT(*) AS n FROM resource_resolutions WHERE project_id = ?')
      .get(pid) as { n: number }
    expect(count.n).toBe(1)
  })
})

// ── project card ──────────────────────────────────────────────────────────────

describe('project card', () => {
  it('lazily creates an empty card on first read', () => {
    const pid = seedProject()
    const card = getProjectCard(pid)
    expect(card.projectId).toBe(pid)
    expect(card.purpose).toBe('')
    expect(card.repos).toEqual([])
    expect(card.glossary).toEqual({})
  })

  it('upserts fields and round-trips arrays/maps', () => {
    const pid = seedProject()
    const card = upsertProjectCard(pid, {
      purpose: 'Ship the thing',
      repos: ['org/repo'],
      services: ['checkout', 'payments'],
      activeGoal: 'reduce p99',
      glossary: { mesh: 'the service mesh' },
    })
    expect(card.purpose).toBe('Ship the thing')
    expect(card.services).toEqual(['checkout', 'payments'])
    expect(card.glossary).toEqual({ mesh: 'the service mesh' })
    // re-read persists
    expect(getProjectCard(pid).activeGoal).toBe('reduce p99')
  })
})

// ── MCP servers ───────────────────────────────────────────────────────────────

describe('MCP servers', () => {
  it('upserts, lists, gets, and deletes', () => {
    const pid = seedProject()
    upsertMcpServer(pid, 'dd-1', {
      label: 'Datadog',
      config: { command: 'datadog-mcp', args: ['--stdio'], env: { DD_KEY: 'x' } },
    })
    expect(listMcpServers(pid)).toHaveLength(1)
    expect(getMcpServer('dd-1')?.config.command).toBe('datadog-mcp')

    // update in place (same id)
    upsertMcpServer(pid, 'dd-1', {
      label: 'Datadog prod',
      config: { command: 'datadog-mcp', args: [], env: {} },
    })
    expect(listMcpServers(pid)).toHaveLength(1)
    expect(getMcpServer('dd-1')?.label).toBe('Datadog prod')

    deleteMcpServer('dd-1')
    expect(listMcpServers(pid)).toHaveLength(0)
    expect(getMcpServer('dd-1')).toBeNull()
  })
})

// ── cascade on project delete ─────────────────────────────────────────────────

describe('cascade', () => {
  it('hard-deleting a project cascades resources/cards/servers', () => {
    const pid = seedProject()
    createResource(pid, { title: 'R' })
    upsertProjectCard(pid, { purpose: 'p' })
    upsertMcpServer(pid, 's1', { label: 'S', config: { command: 'x', args: [], env: {} } })

    db.query('DELETE FROM projects WHERE id = ?').run(pid)

    const rCount = db.query('SELECT COUNT(*) AS n FROM resources WHERE project_id = ?').get(pid) as { n: number }
    const cCount = db.query('SELECT COUNT(*) AS n FROM project_cards WHERE project_id = ?').get(pid) as { n: number }
    const sCount = db.query('SELECT COUNT(*) AS n FROM project_mcp_servers WHERE project_id = ?').get(pid) as { n: number }
    expect(rCount.n).toBe(0)
    expect(cCount.n).toBe(0)
    expect(sCount.n).toBe(0)
  })
})
