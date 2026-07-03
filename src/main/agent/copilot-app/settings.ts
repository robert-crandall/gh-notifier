/**
 * Persisted settings for desktop-app delegation, stored in the shared
 * `sync_metadata` key-value table (same pattern as the notification-sync
 * settings). Two keys:
 *   - the app-delegate feature flag (default OFF until PR3 gives the delegated
 *     session durable rediscovery on its todo); and
 *   - the "repos root" used to resolve local checkouts (default ~/repos).
 */

import { getDb } from '../../db'
import { DEFAULT_REPOS_ROOT } from './cwd'

const APP_DELEGATE_ENABLED_KEY = 'copilot_app_delegate_enabled'
const REPOS_ROOT_KEY = 'copilot_repos_root'

function readMeta(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM sync_metadata WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row === undefined ? null : row.value
}

function writeMeta(key: string, value: string): void {
  getDb().prepare('INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)').run(key, value)
}

/** Whether the desktop-app delegate path is enabled. Default false. */
export function getAppDelegateEnabled(): boolean {
  return readMeta(APP_DELEGATE_ENABLED_KEY) === 'true'
}

export function setAppDelegateEnabled(enabled: boolean): void {
  writeMeta(APP_DELEGATE_ENABLED_KEY, enabled ? 'true' : 'false')
}

/** The configured repos root (raw string; `~` is expanded by the cwd resolver). */
export function getReposRoot(): string {
  const value = readMeta(REPOS_ROOT_KEY)?.trim()
  return value !== undefined && value.length > 0 ? value : DEFAULT_REPOS_ROOT
}

export function setReposRoot(root: string): void {
  const trimmed = root.trim()
  writeMeta(REPOS_ROOT_KEY, trimmed.length > 0 ? trimmed : DEFAULT_REPOS_ROOT)
}
