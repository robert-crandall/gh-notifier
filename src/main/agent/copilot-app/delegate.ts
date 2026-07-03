/**
 * Delegate strategy: try the installed Copilot desktop app, else fall back to a
 * cloud `gh agent-task`. This is the one place the two paths meet.
 *
 * Idempotency boundary (prevents double-delegation): the app path is only
 * attempted when the flag is on, the app is running, AND a trusted local
 * checkout resolves. A pre-create failure (`AppUnavailableError`) is safe to
 * fall back to cloud. Anything after `create_session` was sent
 * (`CreateAmbiguousError` and beyond) must NOT fall back — we surface a
 * DELEGATE_FAILED error instead, because the app may have created a session we
 * can't see and a cloud task would duplicate the work.
 */

import type {
  AppDelegateSkipReason,
  CopilotAppSession,
  CopilotSession,
  DelegatePayload,
  DelegateResult,
} from '../../../shared/ipc-channels'
import { discoverWsEndpoint, type WsEndpoint } from './discover'
import { resolveLocalCwd, type CwdResolution } from './cwd'
import { AppUnavailableError, CreateAmbiguousError, delegateOverWs, type DelegateOverWsResult } from './client'
import { insertAppSession, type InsertAppSessionInput } from './store'
import { getAppDelegateEnabled, getReposRoot } from './settings'
import { getProjectOverridePath } from './project-cwd'
import { launchAgentTask } from '../../copilot/launch'
import { insertLaunchedSession } from '../../copilot/db'

export interface DelegateDeps {
  appEnabled: () => boolean
  discover: () => WsEndpoint | null
  resolveCwd: (owner: string, repo: string, projectId: number | null) => CwdResolution
  wsDelegate: (endpoint: WsEndpoint, cwd: string, prompt: string, model?: string) => Promise<DelegateOverWsResult>
  persistAppSession: (input: InsertAppSessionInput) => CopilotAppSession
  cloudDelegate: (payload: DelegatePayload) => Promise<CopilotSession>
}

/** Production wiring for the delegate strategy. */
export function createDefaultDelegateDeps(): DelegateDeps {
  return {
    appEnabled: getAppDelegateEnabled,
    discover: () => discoverWsEndpoint(),
    resolveCwd: (owner, repo, projectId) =>
      resolveLocalCwd(owner, repo, {
        reposRoot: getReposRoot(),
        overridePath: projectId !== null ? getProjectOverridePath(projectId) : null,
      }),
    wsDelegate: (endpoint, cwd, prompt, model) => delegateOverWs(endpoint, cwd, prompt, model),
    persistAppSession: insertAppSession,
    cloudDelegate: async (payload) => {
      const parsed = await launchAgentTask(payload)
      return insertLaunchedSession({
        id: parsed.sessionId,
        title: payload.prompt.trim(),
        repoOwner: payload.repoOwner.trim(),
        repoName: payload.repoName.trim(),
        htmlUrl: parsed.prUrl ?? parsed.sessionUrl,
        linkedPrUrl: parsed.prUrl,
        projectId: payload.projectId,
      })
    },
  }
}

function validatePayload(payload: DelegatePayload): { prompt: string } {
  const prompt = payload.prompt.trim()
  if (prompt.length === 0) throw new Error('DELEGATE_FAILED: a prompt is required')
  const owner = payload.repoOwner.trim()
  const name = payload.repoName.trim()
  if (owner.length === 0 || name.length === 0) {
    throw new Error('DELEGATE_FAILED: a target repository is required')
  }
  return { prompt }
}

/**
 * Attempt the desktop-app path. Returns a `DelegateResult` when the app handled
 * it, `'skip'` when the app path isn't taken (fall back to cloud), or throws a
 * DELEGATE_FAILED error when the create was ambiguous (must NOT fall back).
 */
async function tryAppDelegate(
  payload: DelegatePayload,
  prompt: string,
  deps: DelegateDeps
): Promise<DelegateResult | 'skip'> {
  if (!deps.appEnabled()) return 'skip'
  // A base-branch request can only be honored by the cloud path (`gh agent-task
  // -b`); the desktop app runs in whatever branch the local checkout is on. So
  // an explicit base branch routes to cloud rather than silently ignoring it.
  if (payload.baseBranch !== undefined && payload.baseBranch.trim().length > 0) return 'skip'
  const endpoint = deps.discover()
  if (endpoint === null) return 'skip' // app not running
  const cwd = deps.resolveCwd(payload.repoOwner.trim(), payload.repoName.trim(), payload.projectId)
  if (!cwd.ok) return 'skip' // no trusted local checkout → cloud

  let ws: DelegateOverWsResult
  try {
    ws = await deps.wsDelegate(endpoint, cwd.cwd, prompt, undefined)
  } catch (err) {
    if (err instanceof AppUnavailableError) return 'skip' // pre-create → cloud is safe
    if (err instanceof CreateAmbiguousError) {
      // The app may have opened a session we can't see. Never start a cloud task
      // too (that would double-delegate); tell the user to check the app.
      throw new Error(
        'DELEGATE_FAILED: The Copilot app may have opened a session, and no cloud task was started - check the Copilot app before retrying.',
        { cause: err }
      )
    }
    // Any other post-create failure is also not safe to fall back on.
    throw new Error(`DELEGATE_FAILED: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }

  const session = deps.persistAppSession({
    id: ws.sessionId,
    projectId: payload.projectId,
    cwd: cwd.cwd,
    title: prompt,
    repoOwner: payload.repoOwner.trim(),
    repoName: payload.repoName.trim(),
  })
  return ws.sendOk ? { kind: 'app', session } : { kind: 'app-send-failed', session }
}

/** Run the full delegate ladder. */
export async function delegateTask(payload: DelegatePayload, deps: DelegateDeps): Promise<DelegateResult> {
  const { prompt } = validatePayload(payload)

  const appResult = await tryAppDelegate(payload, prompt, deps)
  if (appResult !== 'skip') return appResult

  const session = await deps.cloudDelegate(payload)
  return { kind: 'cloud', session }
}

/** Diagnose whether the app path would be taken for a repo (for a UI hint). */
export function appDelegateAvailability(
  owner: string,
  repo: string,
  projectId: number | null,
  deps: DelegateDeps
): { appAvailable: true } | { appAvailable: false; reason: AppDelegateSkipReason } {
  if (!deps.appEnabled()) return { appAvailable: false, reason: 'flag_disabled' }
  if (deps.discover() === null) return { appAvailable: false, reason: 'app_not_running' }
  if (!deps.resolveCwd(owner.trim(), repo.trim(), projectId).ok) {
    return { appAvailable: false, reason: 'no_local_cwd' }
  }
  return { appAvailable: true }
}

/**
 * Validate a session id and build the sanctioned open-in-app deep link, or null
 * when the id is unsafe. Only uuid-shaped / alphanumeric-dash ids are allowed so
 * nothing can be injected into the URL.
 */
export function buildAppSessionDeepLink(sessionId: string): string | null {
  const id = sessionId.trim()
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return null
  return `github-app://sessions/${id}`
}
