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
  getProjectCard,
  upsertProjectCard,
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
    expect(r.aliases).toEqual([])
    expect(r.tags).toEqual({})
    expect(r.url).toBeNull()
  })

  it('round-trips arrays, maps, and link metadata', () => {
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
      externalRef: 'dash-123',
      provenance: 'captured',
    })
    const fetched = getResource(r.id)
    expect(fetched).not.toBeNull()
    expect(fetched?.tags).toEqual({ cluster: 'us-east', system: 'payments' })
    expect(fetched?.aliases).toEqual(['mesh latency', 'p99'])
    expect(fetched?.url).toBe('https://example.test/dash')
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

  it('can clear url by passing null', () => {
    const pid = seedProject()
    const r = createResource(pid, { title: 'X', url: 'https://x.test' })
    const updated = updateResource(r.id, { url: null })
    expect(updated.url).toBeNull()
  })

  it('throws for a missing record', () => {
    expect(() => updateResource(9999, { title: 'Nope' })).toThrow(/not found/)
  })

  it('normalizes whitespace on write (trims fields, whitespace-only url -> null)', () => {
    const pid = seedProject()
    const r = createResource(pid, {
      title: 'X',
      source: '  datadog  ',
      service: ' checkout ',
      url: '   ',
    })
    expect(r.source).toBe('datadog')
    expect(r.service).toBe('checkout')
    expect(r.url).toBeNull() // whitespace-only -> null

    const updated = updateResource(r.id, { source: '  splunk  ' })
    expect(updated.source).toBe('splunk')
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

// ── cascade on project delete ─────────────────────────────────────────────────

describe('cascade', () => {
  it('hard-deleting a project cascades resources/cards', () => {
    const pid = seedProject()
    createResource(pid, { title: 'R' })
    upsertProjectCard(pid, { purpose: 'p' })

    db.query('DELETE FROM projects WHERE id = ?').run(pid)

    const rCount = db.query('SELECT COUNT(*) AS n FROM resources WHERE project_id = ?').get(pid) as { n: number }
    const cCount = db.query('SELECT COUNT(*) AS n FROM project_cards WHERE project_id = ?').get(pid) as { n: number }
    expect(rCount.n).toBe(0)
    expect(cCount.n).toBe(0)
  })
})
