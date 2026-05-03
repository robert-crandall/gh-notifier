/**
 * GitHub session source — fetches Copilot agent tasks via `gh agent-task list`.
 *
 * Shells out to the gh CLI; does not use the GitHub REST API directly.
 * Any failure (non-zero exit, parse error) logs a warning and returns [].
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { resolveProjectId } from './resolve-project'
import type { CopilotSession, CopilotSessionStatus } from '../../shared/ipc-channels'

const execFileAsync = promisify(execFile)

const GH_FIELDS = [
  'id', 'name', 'state', 'repository',
  'createdAt', 'updatedAt', 'completedAt',
  'pullRequestUrl', 'pullRequestState',
  'pullRequestTitle', 'pullRequestNumber',
].join(',')

interface AgentTaskRow {
  id: string
  name: string
  state: string
  repository: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  pullRequestUrl: string | null
  pullRequestState: string | null
  pullRequestTitle: string | null
  pullRequestNumber: number | null
}

const TERMINAL_STATES = new Set(['completed', 'cancelled', 'failed'])

function deriveStatus(row: AgentTaskRow): CopilotSessionStatus {
  if (TERMINAL_STATES.has(row.state)) return 'completed'
  if (row.pullRequestUrl !== null && row.pullRequestState === 'OPEN') return 'pr_ready'
  if (row.state === 'idle') return 'waiting'
  return 'in_progress'
}

function mapRow(row: AgentTaskRow): CopilotSession {
  let repoOwner: string | null = null
  let repoName: string | null = null
  let projectId: number | null = null

  if (row.repository) {
    const slash = row.repository.indexOf('/')
    if (slash !== -1) {
      repoOwner = row.repository.slice(0, slash)
      repoName = row.repository.slice(slash + 1)
      projectId = resolveProjectId(repoOwner, repoName, row.pullRequestNumber)
    }
  }

  return {
    id: row.id,
    projectId,
    source: 'github',
    status: deriveStatus(row),
    title: row.name,
    htmlUrl: row.pullRequestUrl,
    startedAt: row.createdAt,
    updatedAt: row.updatedAt,
    repoOwner,
    repoName,
    branch: null,
    linkedPrUrl: row.pullRequestUrl,
  }
}

/** Fetches all GitHub agent tasks and maps them to CopilotSession objects. */
export async function fetchGithubSessions(): Promise<CopilotSession[]> {
  try {
    const { stdout } = await execFileAsync('gh', [
      'agent-task', 'list',
      '--json', GH_FIELDS,
      '-L', '200',
    ])

    const rows = JSON.parse(stdout) as AgentTaskRow[]
    return rows.map(mapRow)
  } catch (err) {
    console.warn('[copilot/github] Failed to fetch agent tasks:', err)
    return []
  }
}
