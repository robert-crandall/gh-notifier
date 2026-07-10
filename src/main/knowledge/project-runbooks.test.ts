import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectCard } from '../../shared/ipc-channels'

// Control the project card without a DB; use the real store against a temp dir.
const { getProjectCardReadOnly } = vi.hoisted(() => ({
  getProjectCardReadOnly: vi.fn<(projectId: number) => ProjectCard>(),
}))
vi.mock('../context/registry', () => ({ getProjectCardReadOnly }))

import { listRunbooksForProject } from './project-runbooks'
import { writeServiceKnowledge } from './store'

let dir = ''
let prevEnv: string | undefined

beforeEach(() => {
  prevEnv = process.env.GH_PROJECTS_KNOWLEDGE_DIR
  dir = mkdtempSync(join(tmpdir(), 'gh-runbooks-'))
  process.env.GH_PROJECTS_KNOWLEDGE_DIR = dir
  getProjectCardReadOnly.mockReset()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (prevEnv === undefined) delete process.env.GH_PROJECTS_KNOWLEDGE_DIR
  else process.env.GH_PROJECTS_KNOWLEDGE_DIR = prevEnv
})

function card(services: string[]): ProjectCard {
  return { projectId: 1, purpose: '', repos: [], services, activeGoal: '', glossary: {}, updatedAt: 'now' }
}

describe('listRunbooksForProject', () => {
  it('returns a runbook per service with correct statuses', async () => {
    await writeServiceKnowledge({ service: 'web', markdown: 'web runbook' }, dir)
    getProjectCardReadOnly.mockReturnValue(card(['web', 'payments-api']))

    const out = listRunbooksForProject(1)
    expect(out).toHaveLength(2)
    const web = out.find((r) => r.service === 'web')
    const pay = out.find((r) => r.service === 'payments-api')
    expect(web?.status).toBe('ok')
    expect(web?.markdown).toContain('web runbook')
    expect(pay?.status).toBe('missing')
  })

  it('dedupes services that fold to the same key', () => {
    getProjectCardReadOnly.mockReturnValue(card(['API', 'api', ' api ']))
    const out = listRunbooksForProject(1)
    expect(out).toHaveLength(1)
    expect(out[0].key).toBe('api')
  })

  it('marks an invalid service name honestly instead of failing', () => {
    getProjectCardReadOnly.mockReturnValue(card(['Bad Name', '../evil']))
    const out = listRunbooksForProject(1)
    expect(out).toHaveLength(2)
    for (const r of out) {
      expect(r.status).toBe('invalid')
      expect(r.key).toBeNull()
      expect(r.reason).toBeTruthy()
    }
  })

  it('skips blank service entries', () => {
    getProjectCardReadOnly.mockReturnValue(card(['', '   ', 'web']))
    const out = listRunbooksForProject(1)
    expect(out.map((r) => r.service)).toEqual(['web'])
  })
})
