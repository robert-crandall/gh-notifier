/**
 * Token storage using Electron's safeStorage API.
 *
 * safeStorage encrypts/decrypts using OS-level keys (on macOS: a key derived
 * from the login session, stored once in Keychain as "Electron Safe Storage").
 * Reading back the token requires no user interaction — no unlock prompt.
 * The encrypted bytes live in a plain file inside the app's userData directory.
 */

import { safeStorage, app } from 'electron'
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'

function tokenPath(): string {
  return join(app.getPath('userData'), 'auth.enc')
}

function assertEncryptionAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('[auth] safeStorage encryption unavailable — token cannot be persisted')
  }
}

export function saveToken(token: string): void {
  assertEncryptionAvailable()
  const encrypted = safeStorage.encryptString(token)
  writeFileSync(tokenPath(), encrypted)
}

export function loadToken(): string | null {
  const path = tokenPath()
  if (!existsSync(path)) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const encrypted = readFileSync(path)
    return safeStorage.decryptString(encrypted)
  } catch {
    // Corrupted or stale file — treat as no token
    unlinkSync(path)
    return null
  }
}

export function clearToken(): void {
  const path = tokenPath()
  if (existsSync(path)) unlinkSync(path)
}
