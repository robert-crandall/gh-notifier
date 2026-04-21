import { Octokit } from '@octokit/rest'
import type { AuthStatus } from '../../shared/ipc-channels'

let octokitInstance: Octokit | null = null

export function initOctokit(token: string): Octokit {
  octokitInstance = new Octokit({ auth: token })
  return octokitInstance
}

export function getOctokit(): Octokit {
  if (!octokitInstance) {
    throw new Error('Octokit not initialized — user must authenticate first')
  }
  return octokitInstance
}

export function clearOctokit(): void {
  octokitInstance = null
}

export function isOctokitReady(): boolean {
  return octokitInstance !== null
}

/** Fetches the authenticated user and returns a populated AuthStatus. */
export async function fetchAuthStatus(octokit: Octokit): Promise<AuthStatus> {
  const { data } = await octokit.rest.users.getAuthenticated()
  return {
    authenticated: true,
    login: data.login,
    avatarUrl: data.avatar_url
  }
}
