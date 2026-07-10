import { describe, it, expect } from 'vitest'
import type { CopilotSession, CopilotAppSession } from '@shared/ipc-channels'
import { mergeCopilotSessions } from './useCopilotSessions'

function cloud(overrides: Partial<CopilotSession>): CopilotSession {
  return {
    id: 'c',
    projectId: 1,
    source: 'github',
    status: 'in_progress',
    title: 'Cloud task',
    htmlUrl: null,
    startedAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    repoOwner: 'o',
    repoName: 'r',
    branch: null,
    linkedPrUrl: null,
    pinnedProjectId: null,
    ...overrides,
  }
}

function app(overrides: Partial<CopilotAppSession>): CopilotAppSession {
  return {
    id: 'a',
    projectId: 1,
    cwd: '/tmp/repo',
    title: 'App session',
    status: 'in_progress',
    repoOwner: 'o',
    repoName: 'r',
    origin: 'launched',
    pinnedProjectId: null,
    createdAt: '2026-07-01 00:00:00',
    updatedAt: '2026-07-01 00:00:00',
    ...overrides,
  }
}

describe('mergeCopilotSessions', () => {
  it('merges both sources and sorts by updatedAt desc across the ISO and SQLite formats', () => {
    // Cloud uses ISO 8601; app uses SQLite space format. Both are UTC, so the app
    // row at 12:00 must sort ahead of the cloud row at 10:00 despite the format gap.
    const rows = mergeCopilotSessions(
      [cloud({ id: 'c1', title: 'cloud older', updatedAt: '2026-07-02T10:00:00Z' })],
      [app({ id: 'a1', title: 'app newer', updatedAt: '2026-07-02 12:00:00' })]
    )
    expect(rows.map((r) => r.title)).toEqual(['app newer', 'cloud older'])
    expect(rows.map((r) => r.key)).toEqual(['app:a1', 'cloud:c1'])
  })

  it('prefixes keys so a cloud and an app session sharing a UUID cannot collide', () => {
    const rows = mergeCopilotSessions([cloud({ id: 'same' })], [app({ id: 'same' })])
    expect(new Set(rows.map((r) => r.key)).size).toBe(2)
  })

  it('picks the first safe GitHub URL, preferring the PR link', () => {
    const [row] = mergeCopilotSessions(
      [cloud({ linkedPrUrl: 'https://github.com/o/r/pull/9', htmlUrl: 'https://github.com/o/r/issues/1' })],
      []
    )
    expect(row.githubUrl).toBe('https://github.com/o/r/pull/9')
  })

  it('falls back to htmlUrl when the PR link is missing or unsafe', () => {
    const [missing] = mergeCopilotSessions([cloud({ linkedPrUrl: null, htmlUrl: 'https://github.com/o/r' })], [])
    expect(missing.githubUrl).toBe('https://github.com/o/r')

    const [unsafe] = mergeCopilotSessions(
      [cloud({ linkedPrUrl: 'javascript:alert(1)', htmlUrl: 'https://github.com/o/r' })],
      []
    )
    expect(unsafe.githubUrl).toBe('https://github.com/o/r')
  })

  it('carries no GitHub URL and the deep-link id for app rows; cloud rows carry no app id', () => {
    const rows = mergeCopilotSessions([cloud({ id: 'c1' })], [app({ id: 'a1' })])
    const cloudRow = rows.find((r) => r.kind === 'cloud')
    const appRow = rows.find((r) => r.kind === 'app')
    expect(appRow?.appSessionId).toBe('a1')
    expect(appRow?.githubUrl).toBeNull()
    expect(appRow?.origin).toBe('launched')
    expect(cloudRow?.appSessionId).toBeNull()
  })

  it('uses startedAt for cloud and createdAt for app as the displayed start', () => {
    const [cloudRow] = mergeCopilotSessions([cloud({ startedAt: '2026-01-01T00:00:00Z' })], [])
    expect(cloudRow.startedAt).toBe('2026-01-01T00:00:00Z')
    const [appRow] = mergeCopilotSessions([], [app({ createdAt: '2026-02-02 00:00:00' })])
    expect(appRow.startedAt).toBe('2026-02-02 00:00:00')
  })
})
