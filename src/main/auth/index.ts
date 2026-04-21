/**
 * Auth module entry point.
 *
 * Call initAuth() once after app.whenReady() to restore a persisted token.
 */

import { loadToken, saveToken, clearToken } from './storage'
import { initOctokit, fetchAuthStatus, isOctokitReady, clearOctokit, getOctokit } from './octokit'
import type { AuthStatus } from '../../shared/ipc-channels'

export { getOctokit } from './octokit'

/** Restores a previously saved token on startup, if one exists. */
export async function initAuth(): Promise<void> {
  const token = loadToken()
  if (!token) return
  const octokit = initOctokit(token)
  try {
    await fetchAuthStatus(octokit)
    console.log('[auth] Token restored from storage')
  } catch (err) {
    console.warn('[auth] Stored token is invalid, clearing:', err)
    clearToken()
    clearOctokit()
  }
}

/** Returns the current auth status. */
export async function getAuthStatus(): Promise<AuthStatus> {
  if (!isOctokitReady()) return { authenticated: false }
  try {
    return await fetchAuthStatus(getOctokit())
  } catch {
    return { authenticated: false }
  }
}

/**
 * Validates a PAT, stores it, and returns the auth status.
 * Throws with a user-facing message if the token is rejected by GitHub.
 */
export async function savePat(token: string): Promise<AuthStatus> {
  const trimmed = token.trim()
  if (!trimmed) throw new Error('Token cannot be empty.')

  const octokit = initOctokit(trimmed)
  let status: AuthStatus
  try {
    status = await fetchAuthStatus(octokit)
  } catch {
    clearOctokit()
    throw new Error('Token is invalid or lacks the required permissions.')
  }

  saveToken(trimmed)
  return status
}

/** Clears the stored token and resets auth state. */
export function logout(): void {
  clearToken()
  clearOctokit()
}
