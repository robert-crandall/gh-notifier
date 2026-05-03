/**
 * VS Code Copilot Chat session source.
 *
 * Reads sessions from VS Code's workspace storage (both Stable and Insiders):
 *   ~/Library/Application Support/Code[-Insiders]/User/workspaceStorage/<hash>/GitHub.copilot-chat/
 *
 * For each workspace hash:
 *   - Reads workspace.json to get the local folder path
 *   - Resolves that path to a GitHub repo via the repo_rules table
 *   - Reads transcripts/*.jsonl and derives session status from events
 *
 * Falls back gracefully if any path doesn't exist.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execFileSync } from 'child_process'
import { resolveProjectId } from './resolve-project'
import type { CopilotSession, CopilotSessionStatus } from '../../shared/ipc-channels'

const DEBOUNCE_MS = 500
const INACTIVE_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes

const VSCODE_ROOTS = [
  path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage'),
  path.join(os.homedir(), 'Library', 'Application Support', 'Code - Insiders', 'User', 'workspaceStorage'),
]

interface WorkspaceJson {
  folder?: string
}

interface EventLine {
  type?: string
  event?: string
}

function parseGitRemote(folderPath: string): { owner: string; name: string } | null {
  try {
    const remoteUrl = execFileSync('git', ['-C', folderPath, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()

    // Match ssh: git@github.com:owner/repo.git  or  https://github.com/owner/repo.git
    const sshMatch = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(remoteUrl)
    if (sshMatch) return { owner: sshMatch[1], name: sshMatch[2] }
    return null
  } catch {
    return null
  }
}

function deriveVscodeStatus(transcriptPath: string): CopilotSessionStatus {
  try {
    const stat = fs.statSync(transcriptPath)
    const mtime = stat.mtimeMs
    const now = Date.now()
    const ageMs = now - mtime

    if (ageMs > INACTIVE_THRESHOLD_MS) return 'completed'

    const content = fs.readFileSync(transcriptPath, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)

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
        return ageMs > INACTIVE_THRESHOLD_MS ? 'completed' : 'in_progress'
      }
    }

    return ageMs > INACTIVE_THRESHOLD_MS ? 'completed' : 'waiting'
  } catch {
    return 'completed'
  }
}

function readTranscript(
  transcriptPath: string,
  repoOwner: string | null,
  repoName: string | null,
  projectId: number | null,
  folderName: string
): CopilotSession {
  const sessionId = `vscode-${path.basename(transcriptPath, '.jsonl')}`
  let stat: fs.Stats
  try {
    stat = fs.statSync(transcriptPath)
  } catch {
    stat = { mtimeMs: Date.now(), birthtimeMs: Date.now() } as fs.Stats
  }

  const startedAt = new Date(stat.birthtimeMs).toISOString()
  const updatedAt = new Date(stat.mtimeMs).toISOString()
  const status = deriveVscodeStatus(transcriptPath)

  return {
    id: sessionId,
    projectId,
    source: 'vscode-chat',
    status,
    title: folderName,
    htmlUrl: null,
    startedAt,
    updatedAt,
    repoOwner,
    repoName,
    branch: null,
    linkedPrUrl: null,
  }
}

function readWorkspaceHash(hashDir: string): CopilotSession[] {
  const chatDir = path.join(hashDir, 'GitHub.copilot-chat')
  if (!fs.existsSync(chatDir)) return []

  // Resolve repo from workspace.json
  let repoOwner: string | null = null
  let repoName: string | null = null
  let projectId: number | null = null
  let folderName = path.basename(hashDir)

  try {
    const workspaceJsonPath = path.join(hashDir, 'workspace.json')
    if (fs.existsSync(workspaceJsonPath)) {
      const ws = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf8')) as WorkspaceJson
      if (ws.folder) {
        const localPath = decodeURIComponent(ws.folder.replace(/^file:\/\//, ''))
        folderName = path.basename(localPath)
        const remote = parseGitRemote(localPath)
        if (remote) {
          repoOwner = remote.owner
          repoName = remote.name
          projectId = resolveProjectId(repoOwner, repoName)
        }
      }
    }
  } catch (err) {
    console.warn(`[copilot/vscode] Failed to read workspace.json in ${hashDir}:`, err)
  }

  const transcriptsDir = path.join(chatDir, 'transcripts')
  if (!fs.existsSync(transcriptsDir)) return []

  const sessions: CopilotSession[] = []
  try {
    const files = fs.readdirSync(transcriptsDir).filter((f) => f.endsWith('.jsonl'))
    for (const file of files) {
      try {
        sessions.push(
          readTranscript(
            path.join(transcriptsDir, file),
            repoOwner,
            repoName,
            projectId,
            folderName
          )
        )
      } catch (err) {
        console.warn(`[copilot/vscode] Failed to read transcript ${file}:`, err)
      }
    }
  } catch (err) {
    console.warn(`[copilot/vscode] Failed to read transcripts dir in ${hashDir}:`, err)
  }

  return sessions
}

/** Reads all VS Code Copilot Chat sessions from Stable and Insiders storage. */
export function fetchVscodeSessions(): CopilotSession[] {
  const sessions: CopilotSession[] = []

  for (const storageRoot of VSCODE_ROOTS) {
    if (!fs.existsSync(storageRoot)) continue

    try {
      const hashes = fs.readdirSync(storageRoot, { withFileTypes: true })
      for (const entry of hashes) {
        if (!entry.isDirectory()) continue
        try {
          const found = readWorkspaceHash(path.join(storageRoot, entry.name))
          sessions.push(...found)
        } catch (err) {
          console.warn(`[copilot/vscode] Failed to process hash ${entry.name}:`, err)
        }
      }
    } catch (err) {
      console.warn(`[copilot/vscode] Failed to scan ${storageRoot}:`, err)
    }
  }

  return sessions
}

/** Starts watching VS Code workspace storage directories for changes. Returns cleanup fn. */
export function watchVscodeSessions(onChange: () => void): () => void {
  const watchers: fs.FSWatcher[] = []
  let debounceTimer: NodeJS.Timeout | null = null

  const scheduleCallback = () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      onChange()
    }, DEBOUNCE_MS)
  }

  for (const storageRoot of VSCODE_ROOTS) {
    if (!fs.existsSync(storageRoot)) continue
    try {
      watchers.push(fs.watch(storageRoot, { recursive: true }, scheduleCallback))
    } catch (err) {
      console.warn(`[copilot/vscode] Failed to watch ${storageRoot}:`, err)
    }
  }

  return () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    watchers.forEach((w) => w.close())
  }
}
