import type { RoutingRule, CreateRoutingRulePayload, NotificationThread } from '../../shared/ipc-channels'
import { getDb } from './index'
import { assignThread } from './notifications'

// ── Row types ─────────────────────────────────────────────────────────────────

interface RoutingRuleRow {
  id: number
  project_id: number
  project_name: string
  match_type: string | null
  match_reason: string | null
  match_repo_owner: string | null
  match_repo_name: string | null
  match_org: string | null
  created_at: string
}

// ── Row → domain mapper ───────────────────────────────────────────────────────

function toRoutingRule(row: RoutingRuleRow): RoutingRule {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    matchType: row.match_type,
    matchReason: row.match_reason,
    matchRepoOwner: row.match_repo_owner,
    matchRepoName: row.match_repo_name,
    matchOrg: row.match_org,
    createdAt: row.created_at,
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function listRoutingRules(): RoutingRule[] {
  const rows = getDb()
    .prepare(
      `SELECT rr.*, p.name AS project_name
       FROM routing_rules rr
       JOIN projects p ON p.id = rr.project_id
       ORDER BY rr.created_at ASC`
    )
    .all() as RoutingRuleRow[]
  return rows.map(toRoutingRule)
}

export function createRoutingRule(payload: CreateRoutingRulePayload): RoutingRule {
  const hasCondition =
    payload.matchType != null ||
    payload.matchReason != null ||
    payload.matchRepoOwner != null ||
    payload.matchRepoName != null ||
    payload.matchOrg != null

  if (!hasCondition) {
    throw new Error('A routing rule must have at least one match condition.')
  }

  const db = getDb()
  const inserted = db
    .prepare(
      `INSERT INTO routing_rules
         (project_id, match_type, match_reason, match_repo_owner, match_repo_name, match_org)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(
      payload.projectId,
      payload.matchType?.trim() ?? null,
      payload.matchReason?.trim() ?? null,
      payload.matchRepoOwner?.trim() ?? null,
      payload.matchRepoName?.trim() ?? null,
      payload.matchOrg?.trim() ?? null,
    ) as Omit<RoutingRuleRow, 'project_name'>

  const project = db
    .prepare('SELECT name FROM projects WHERE id = ?')
    .get(payload.projectId) as { name: string }

  return toRoutingRule({ ...inserted, project_name: project.name })
}

export function deleteRoutingRule(id: number): void {
  getDb().prepare('DELETE FROM routing_rules WHERE id = ?').run(id)
}

// ── Rule evaluation ───────────────────────────────────────────────────────────

/**
 * Returns true if the thread matches all non-null conditions on the rule (AND semantics).
 * A rule with no conditions set never matches.
 */
export function routingRuleMatches(rule: RoutingRule, thread: NotificationThread): boolean {
  const hasCondition =
    rule.matchType != null ||
    rule.matchReason != null ||
    rule.matchRepoOwner != null ||
    rule.matchRepoName != null ||
    rule.matchOrg != null

  if (!hasCondition) return false

  if (rule.matchType != null && thread.type.toLowerCase() !== rule.matchType.toLowerCase()) {
    return false
  }
  if (rule.matchReason != null && thread.reason.toLowerCase() !== rule.matchReason.toLowerCase()) {
    return false
  }
  if (
    rule.matchRepoOwner != null &&
    thread.repoOwner.toLowerCase() !== rule.matchRepoOwner.toLowerCase()
  ) {
    return false
  }
  if (
    rule.matchRepoName != null &&
    thread.repoName.toLowerCase() !== rule.matchRepoName.toLowerCase()
  ) {
    return false
  }
  if (
    rule.matchOrg != null &&
    !thread.repoOwner.toLowerCase().includes(rule.matchOrg.toLowerCase())
  ) {
    return false
  }

  return true
}

// ── Apply to inbox ────────────────────────────────────────────────────────────

/**
 * Evaluates all routing rules against every inbox thread (project_id IS NULL).
 * Rules are evaluated in creation order; the first matching rule wins.
 * Returns the number of threads that were routed.
 */
export function applyRoutingRulesToInbox(): { matched: number } {
  const rules = listRoutingRules()
  if (rules.length === 0) return { matched: 0 }

  const db = getDb()
  const inboxRows = db
    .prepare(
      `SELECT id, project_id, repo_owner, repo_name, title, type, reason, unread,
              updated_at, last_read_at, api_url, subject_url, subject_state, html_url
       FROM notification_threads
       WHERE project_id IS NULL`
    )
    .all() as Array<{
      id: string
      project_id: number | null
      repo_owner: string
      repo_name: string
      title: string
      type: string
      reason: string
      unread: number
      updated_at: string
      last_read_at: string | null
      api_url: string
      subject_url: string | null
      subject_state: string | null
      html_url: string | null
    }>

  let matched = 0

  for (const row of inboxRows) {
    const thread: NotificationThread = {
      id: row.id,
      projectId: null,
      repoOwner: row.repo_owner,
      repoName: row.repo_name,
      title: row.title,
      type: row.type as NotificationThread['type'],
      reason: row.reason,
      unread: row.unread === 1,
      updatedAt: row.updated_at,
      lastReadAt: row.last_read_at,
      apiUrl: row.api_url,
      subjectUrl: row.subject_url,
      subjectState: row.subject_state as NotificationThread['subjectState'],
      htmlUrl: row.html_url,
    }

    for (const rule of rules) {
      if (routingRuleMatches(rule, thread)) {
        assignThread(thread.id, rule.projectId)
        matched++
        break // first match wins
      }
    }
  }

  return { matched }
}
