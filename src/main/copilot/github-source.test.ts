import { describe, it, expect } from 'vitest'
import { deriveStatus, type AgentTaskRow } from './github-source'

function row(overrides: Partial<AgentTaskRow>): AgentTaskRow {
  return {
    id: 't1',
    name: 'A task',
    state: 'in_progress',
    repository: 'o/r',
    createdAt: '2026-07-02T00:00:00Z',
    updatedAt: '2026-07-02T00:00:00Z',
    completedAt: null,
    pullRequestUrl: null,
    pullRequestState: null,
    pullRequestTitle: null,
    pullRequestNumber: null,
    ...overrides,
  }
}

describe('deriveStatus', () => {
  it('an active task with a freshly-opened draft PR stays in_progress (not pr_ready)', () => {
    expect(deriveStatus(row({ state: 'in_progress', pullRequestUrl: 'https://x/pull/1', pullRequestState: 'OPEN' })))
      .toBe('in_progress')
  })

  it('unknown active states default to in_progress', () => {
    expect(deriveStatus(row({ state: 'queued' }))).toBe('in_progress')
  })

  it('idle means waiting for input', () => {
    expect(deriveStatus(row({ state: 'idle' }))).toBe('waiting')
  })

  it('completed with an open PR is pr_ready', () => {
    expect(deriveStatus(row({ state: 'completed', pullRequestUrl: 'https://x/pull/1', pullRequestState: 'OPEN' })))
      .toBe('pr_ready')
  })

  it('completed with a merged/closed PR is completed', () => {
    expect(deriveStatus(row({ state: 'completed', pullRequestState: 'MERGED' }))).toBe('completed')
    expect(deriveStatus(row({ state: 'completed', pullRequestState: 'CLOSED' }))).toBe('completed')
    expect(deriveStatus(row({ state: 'completed', pullRequestState: null }))).toBe('completed')
  })

  it('failed or cancelled tasks are completed even with a stray open PR', () => {
    expect(deriveStatus(row({ state: 'failed', pullRequestUrl: 'https://x/pull/1', pullRequestState: 'OPEN' })))
      .toBe('completed')
    expect(deriveStatus(row({ state: 'cancelled', pullRequestUrl: 'https://x/pull/1', pullRequestState: 'OPEN' })))
      .toBe('completed')
  })
})
