import { describe, it, expect, vi } from 'vitest'
import type { AppDelegateFallbackReason, CopilotSession } from '@shared/ipc-channels'
import { cloudFallbackMessage } from './cloudFallbackMessage'

const session: CopilotSession = {
  id: 's1', projectId: 1, source: 'github', status: 'in_progress', title: 'Fix it',
  htmlUrl: null, startedAt: '', updatedAt: '', repoOwner: 'me', repoName: 'foo',
  branch: null, linkedPrUrl: null, pinnedProjectId: 1,
}

describe('cloudFallbackMessage', () => {
  // Every reason must produce a distinct, honest, non-empty message — the whole
  // point of the fix is that the cloud fallback never hides why the app was
  // bypassed.
  const reasons: AppDelegateFallbackReason[] = [
    'flag_disabled',
    'app_not_running',
    'app_unavailable',
    'no_local_cwd',
    'base_branch',
  ]

  it('returns a distinct, non-empty message for every fallback reason', () => {
    const messages = reasons.map((r) => cloudFallbackMessage(r, session))
    for (const m of messages) expect(m.trim().length).toBeGreaterThan(0)
    expect(new Set(messages).size).toBe(reasons.length)
  })

  it('names the repo when the checkout could not be resolved', () => {
    expect(cloudFallbackMessage('no_local_cwd', session)).toContain('me/foo')
  })

  it('falls back to a generic repo phrase when owner/name are missing', () => {
    const anon = { ...session, repoOwner: null, repoName: null }
    expect(cloudFallbackMessage('no_local_cwd', anon)).toContain('this repo')
  })

  it('frames a base-branch fallback as intentional routing, not a failure', () => {
    expect(cloudFallbackMessage('base_branch', session).toLowerCase()).toContain('base branch')
  })

  it('warns and stays safe on an unexpected reason from the IPC boundary', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Simulate a future/unknown reason arriving across the untyped IPC boundary.
    const msg = cloudFallbackMessage('mystery' as AppDelegateFallbackReason, session)
    expect(msg.trim().length).toBeGreaterThan(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
