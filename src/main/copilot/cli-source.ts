/**
 * Copilot CLI session source.
 *
 * Reads sessions from ~/.copilot/session-state/<session-uuid>/.
 * Each session directory contains workspace.yaml and events.jsonl.
 *
 * Uses fs.watch on the root directory (debounced) to detect new/changed sessions.
 * Falls back gracefully if the directory doesn't exist.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { resolveProjectId } from './resolve-project'
import type { CopilotSession, CopilotSessionStatus } from '../../shared/ipc-channels'

const SESSION_STATE_DIR = path.join(os.homedir(), '.copilot', 'session-state')
const DEBOUNCE_MS = 500
const INACTIVE_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes

interface WorkspaceYaml {
  id?: string
  cwd?: string
  git_root?: string
  repository?: string
  branch?: string
  summary?: string
  created_at?: string
  updated_at?: string
}

interface EventLine {
  type?: string
  event?: string
}

function parseWorkspaceYaml(content: string): WorkspaceYaml {
  // Minimal YAML key: value parser — no YAML library needed for this flat structure
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '')
    result[key] = value
  }
  return result as WorkspaceYaml
}

function deriveCliStatus(eventsPath: string, updatedAt: string): CopilotSessionStatus {
  try {
    const stat = fs.statSync(eventsPath)
    const mtime = stat.mtimeMs
    const now = Date.now()
    const ageMs = now - mtime

    if (ageMs > INACTIVE_THRESHOLD_MS) return 'completed'

    const content = fs.readFileSync(eventsPath, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)

    // Walk lines in reverse to find the last meaningful event
    for (let i = lines.length - 1; i >= 0; i--) {
      let event: EventLine
      try {
        event = JSON.parse(lines[i]) as EventLine
      } catch {
        continue
      }
      const eventType = event.type ?? event.event ?? ''
      if (eventType === 'assistant.turn_end') return 'waiting'
      if (eventType === 'tool.execution_start' || eventType === 'assistant.turn_start') {
        return mtime < now - INACTIVE_THRESHOLD_MS ? 'completed' : 'in_progress'
      }
    }

    // No conclusive event — use age heuristic
    return ageMs > INACTIVE_THRESHOLD_MS ? 'completed' : 'waiting'
  } catch {
    // events.jsonl may not exist yet for brand-new sessions
    return 'in_progress'
  }
}

function readSession(sessionDir: string): CopilotSession | null {
  try {
    const workspacePath = path.join(sessionDir, 'workspace.yaml')
    if (!fs.existsSync(workspacePath)) return null

    const yamlContent = fs.readFileSync(workspacePath, 'utf8')
    const ws = parseWorkspaceYaml(yamlContent)

    const sessionId = ws.id ?? path.basename(sessionDir)
    const repository = ws.repository ?? null
    const now = new Date().toISOString()
    const startedAt = ws.created_at ?? now
    const updatedAt = ws.updated_at ?? now

    let repoOwner: string | null = null
    let repoName: string | null = null
    let projectId: number | null = null

    if (repository) {
      const slash = repository.indexOf('/')
      if (slash !== -1) {
        repoOwner = repository.slice(0, slash)
        repoName = repository.slice(slash + 1)
        projectId = resolveProjectId(repoOwner, repoName)
      }
    }

    const eventsPath = path.join(sessionDir, 'events.jsonl')
    const status = deriveCliStatus(eventsPath, updatedAt)

    return {
      id: sessionId,
      projectId,
      source: 'cli',
      status,
      title: ws.summary ?? ws.cwd ?? sessionId,
      htmlUrl: null,
      startedAt,
      updatedAt,
      repoOwner,
      repoName,
      branch: ws.branch ?? null,
      linkedPrUrl: null,
    }
  } catch (err) {
    console.warn(`[copilot/cli] Failed to read session at ${sessionDir}:`, err)
    return null
  }
}

/** Reads all CLI sessions from the session-state directory. */
export function fetchCliSessions(): CopilotSession[] {
  try {
    if (!fs.existsSync(SESSION_STATE_DIR)) return []

    const entries = fs.readdirSync(SESSION_STATE_DIR, { withFileTypes: true })
    const sessions: CopilotSession[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const session = readSession(path.join(SESSION_STATE_DIR, entry.name))
      if (session !== null) sessions.push(session)
    }

    return sessions
  } catch (err) {
    console.warn('[copilot/cli] Failed to scan session-state directory:', err)
    return []
  }
}

/** Starts watching the session-state directory for changes. Returns a cleanup fn. */
export function watchCliSessions(onChange: () => void): () => void {
  if (!fs.existsSync(SESSION_STATE_DIR)) {
    // Directory doesn't exist — no-op watcher
    return () => { /* nothing to clean up */ }
  }

  let debounceTimer: NodeJS.Timeout | null = null

  const scheduleCallback = () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      onChange()
    }, DEBOUNCE_MS)
  }

  let watcher: fs.FSWatcher | null = null
  try {
    watcher = fs.watch(SESSION_STATE_DIR, { recursive: true }, scheduleCallback)
  } catch (err) {
    console.warn('[copilot/cli] Failed to watch session-state directory:', err)
  }

  return () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    watcher?.close()
  }
}
