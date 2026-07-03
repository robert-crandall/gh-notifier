import { describe, it, expect } from 'vitest'
import { parseAgentTaskCreateOutput, normalizeLaunchPayload } from './launch'

describe('parseAgentTaskCreateOutput', () => {
  it('extracts the session id and PR from a standard agent-session URL', () => {
    const url = 'https://github.com/robert-crandall/gh-notifier/pull/73/agent-sessions/932fbdd1-5ad5-49f5-8546-03d0db3f874e'
    const parsed = parseAgentTaskCreateOutput(`${url}\n`)
    expect(parsed.sessionId).toBe('932fbdd1-5ad5-49f5-8546-03d0db3f874e')
    expect(parsed.prNumber).toBe(73)
    expect(parsed.prUrl).toBe('https://github.com/robert-crandall/gh-notifier/pull/73')
    expect(parsed.sessionUrl).toBe(url)
  })

  it('takes the last non-empty line when gh prints extra output', () => {
    const url = 'https://github.com/o/r/pull/5/agent-sessions/abc-123'
    const parsed = parseAgentTaskCreateOutput(`Some preamble\n\n${url}\n`)
    expect(parsed.sessionId).toBe('abc-123')
    expect(parsed.prNumber).toBe(5)
  })

  it('handles a session URL with no PR segment', () => {
    const url = 'https://github.com/o/r/agent-sessions/deadbeef-0000'
    const parsed = parseAgentTaskCreateOutput(url)
    expect(parsed.sessionId).toBe('deadbeef-0000')
    expect(parsed.prNumber).toBeNull()
    expect(parsed.prUrl).toBeNull()
  })

  it('strips query/hash from the session id', () => {
    const parsed = parseAgentTaskCreateOutput('https://github.com/o/r/pull/9/agent-sessions/xyz-9?tab=logs')
    expect(parsed.sessionId).toBe('xyz-9')
    expect(parsed.prNumber).toBe(9)
  })

  it('throws when no agent-session id is present', () => {
    expect(() => parseAgentTaskCreateOutput('not a url')).toThrow()
    expect(() => parseAgentTaskCreateOutput('')).toThrow()
  })
})

describe('normalizeLaunchPayload', () => {
  it('trims and composes owner/repo', () => {
    const n = normalizeLaunchPayload({
      prompt: '  fix the flaky test  ',
      repoOwner: ' o ',
      repoName: ' r ',
      projectId: 1,
    })
    expect(n.prompt).toBe('fix the flaky test')
    expect(n.repo).toBe('o/r')
    expect(n.baseBranch).toBeNull()
  })

  it('keeps a non-empty base branch', () => {
    const n = normalizeLaunchPayload({
      prompt: 'x', repoOwner: 'o', repoName: 'r', baseBranch: ' develop ', projectId: null,
    })
    expect(n.baseBranch).toBe('develop')
  })

  it('rejects an empty prompt', () => {
    expect(() => normalizeLaunchPayload({ prompt: '   ', repoOwner: 'o', repoName: 'r', projectId: null }))
      .toThrow(/prompt/i)
  })

  it('rejects a missing repo', () => {
    expect(() => normalizeLaunchPayload({ prompt: 'x', repoOwner: '', repoName: 'r', projectId: null }))
      .toThrow(/repository/i)
    expect(() => normalizeLaunchPayload({ prompt: 'x', repoOwner: 'o', repoName: '  ', projectId: null }))
      .toThrow(/repository/i)
  })
})
