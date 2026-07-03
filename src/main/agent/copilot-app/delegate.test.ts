import { describe, it, expect, vi } from 'vitest'

// delegate.ts transitively imports the production db/electron modules via
// createDefaultDelegateDeps; these tests only use injected fakes, so stub the db
// layer to keep the module graph from loading electron/better-sqlite3.
vi.mock('../../db', () => ({ getDb: vi.fn() }))

import {
  delegateTask,
  appDelegateAvailability,
  buildAppSessionDeepLink,
  type DelegateDeps,
} from './delegate'
import { AppUnavailableError, CreateAmbiguousError, type DelegateOverWsResult } from './client'
import type { CopilotAppSession, CopilotSession, DelegatePayload } from '../../../shared/ipc-channels'

const payload: DelegatePayload = {
  prompt: 'do the thing',
  repoOwner: 'me',
  repoName: 'foo',
  projectId: 1,
}

const appSession: CopilotAppSession = {
  id: 'app-1', projectId: 1, cwd: '/repos/foo', title: 'do the thing',
  status: 'in_progress', repoOwner: 'me', repoName: 'foo', createdAt: '', updatedAt: '',
}
const cloudSession: CopilotSession = {
  id: 'cloud-1', projectId: 1, source: 'github', status: 'in_progress', title: 'do the thing',
  htmlUrl: null, startedAt: '', updatedAt: '', repoOwner: 'me', repoName: 'foo',
  branch: null, linkedPrUrl: null, pinnedProjectId: 1,
}

function makeDeps(overrides: Partial<DelegateDeps> = {}): DelegateDeps {
  return {
    appEnabled: () => true,
    discover: () => ({ port: 1, token: 't' }),
    resolveCwd: async () => ({ ok: true, cwd: '/repos/foo' }),
    wsDelegate: async (): Promise<DelegateOverWsResult> => ({ sessionId: 'app-1', sendOk: true }),
    persistAppSession: () => appSession,
    cloudDelegate: async () => cloudSession,
    ...overrides,
  }
}

describe('delegateTask — app path', () => {
  it('delegates to the app when enabled + running + cwd resolves (no cloud)', async () => {
    const cloud = vi.fn(async () => cloudSession)
    const res = await delegateTask(payload, makeDeps({ cloudDelegate: cloud }))
    expect(res).toEqual({ kind: 'app', session: appSession })
    expect(cloud).not.toHaveBeenCalled()
  })

  it('returns app-send-failed when the session was created but the prompt did not send', async () => {
    const cloud = vi.fn(async () => cloudSession)
    const res = await delegateTask(
      payload,
      makeDeps({ wsDelegate: async () => ({ sessionId: 'app-1', sendOk: false }), cloudDelegate: cloud })
    )
    expect(res).toEqual({ kind: 'app-send-failed', session: appSession })
    expect(cloud).not.toHaveBeenCalled()
  })
})

describe('delegateTask — cloud fallback (pre-create only)', () => {
  it('falls back to cloud when the flag is off', async () => {
    const res = await delegateTask(payload, makeDeps({ appEnabled: () => false }))
    expect(res).toEqual({ kind: 'cloud', session: cloudSession })
  })

  it('falls back to cloud when the app is not running', async () => {
    const res = await delegateTask(payload, makeDeps({ discover: () => null }))
    expect(res.kind).toBe('cloud')
  })

  it('falls back to cloud when no trusted local checkout resolves', async () => {
    const res = await delegateTask(payload, makeDeps({ resolveCwd: async () => ({ ok: false, reason: 'no_local_cwd' }) }))
    expect(res.kind).toBe('cloud')
  })

  it('falls back to cloud when a base branch is requested (app WS has no branch concept)', async () => {
    const ws = vi.fn(async () => ({ sessionId: 'x', sendOk: true }))
    const res = await delegateTask({ ...payload, baseBranch: 'main' }, makeDeps({ wsDelegate: ws }))
    expect(res.kind).toBe('cloud')
    expect(ws).not.toHaveBeenCalled()
  })

  it('falls back to cloud on a pre-create AppUnavailableError', async () => {
    const res = await delegateTask(
      payload,
      makeDeps({ wsDelegate: async () => { throw new AppUnavailableError('handshake timeout') } })
    )
    expect(res.kind).toBe('cloud')
  })
})

describe('delegateTask — idempotency boundary (never double-delegate)', () => {
  it('does NOT fall back to cloud after an ambiguous create; surfaces a check-the-app message', async () => {
    const cloud = vi.fn(async () => cloudSession)
    await expect(
      delegateTask(
        payload,
        makeDeps({
          wsDelegate: async () => { throw new CreateAmbiguousError('create sent, no ack') },
          cloudDelegate: cloud,
        })
      )
    ).rejects.toThrow(/check the Copilot app before retrying/)
    expect(cloud).not.toHaveBeenCalled()
  })

  it('rejects an empty prompt without touching either path', async () => {
    const ws = vi.fn(async () => ({ sessionId: 'x', sendOk: true }))
    const cloud = vi.fn(async () => cloudSession)
    await expect(
      delegateTask({ ...payload, prompt: '   ' }, makeDeps({ wsDelegate: ws, cloudDelegate: cloud }))
    ).rejects.toThrow(/DELEGATE_FAILED/)
    expect(ws).not.toHaveBeenCalled()
    expect(cloud).not.toHaveBeenCalled()
  })
})

describe('appDelegateAvailability', () => {
  it('reports the specific skip reason', async () => {
    expect(await appDelegateAvailability('me', 'foo', 1, makeDeps({ appEnabled: () => false }))).toEqual({
      appAvailable: false, reason: 'flag_disabled',
    })
    expect(await appDelegateAvailability('me', 'foo', 1, makeDeps({ discover: () => null }))).toEqual({
      appAvailable: false, reason: 'app_not_running',
    })
    expect(
      await appDelegateAvailability('me', 'foo', 1, makeDeps({ resolveCwd: async () => ({ ok: false, reason: 'no_local_cwd' }) }))
    ).toEqual({ appAvailable: false, reason: 'no_local_cwd' })
    expect(await appDelegateAvailability('me', 'foo', 1, makeDeps())).toEqual({ appAvailable: true })
  })
})

describe('buildAppSessionDeepLink', () => {
  it('builds the deep link for a safe id', () => {
    expect(buildAppSessionDeepLink('2adcd1f7-57ee-47ee-82fa-360a99454c4f')).toBe(
      'github-app://sessions/2adcd1f7-57ee-47ee-82fa-360a99454c4f'
    )
  })
  it('rejects unsafe ids (no injection)', () => {
    expect(buildAppSessionDeepLink('../evil')).toBeNull()
    expect(buildAppSessionDeepLink('a b')).toBeNull()
    expect(buildAppSessionDeepLink('')).toBeNull()
    expect(buildAppSessionDeepLink('x?foo=bar')).toBeNull()
  })
})
