import type { RoutingRule, RoutingRuleAction, CreateRoutingRulePayload, NotificationThread } from '../../shared/ipc-channels'
import { getDb } from './index'

// ── Row types ─────────────────────────────────────────────────────────────────

interface RoutingRuleRow {
  id: number
  project_id: number | null
  action: string
  project_name: string | null
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
    action: row.action as RoutingRuleAction,
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
       LEFT JOIN projects p ON p.id = rr.project_id
       ORDER BY rr.created_at ASC`
    )
    .all() as RoutingRuleRow[]
  return rows.map(toRoutingRule)
}

/** Returns only suppress rules — used for read-time filtering in notification lists. */
export function listSuppressRules(): RoutingRule[] {
  const rows = getDb()
    .prepare(
      `SELECT rr.*, NULL AS project_name
       FROM routing_rules rr
       WHERE rr.action = 'suppress'
       ORDER BY rr.created_at ASC`
    )
    .all() as RoutingRuleRow[]
  return rows.map(toRoutingRule)
}

export function createRoutingRule(payload: CreateRoutingRulePayload): RoutingRule {
  const hasCondition =
    (payload.matchType?.trim().length ?? 0) > 0 ||
    (payload.matchReason?.trim().length ?? 0) > 0 ||
    (payload.matchRepoOwner?.trim().length ?? 0) > 0 ||
    (payload.matchRepoName?.trim().length ?? 0) > 0 ||
    (payload.matchOrg?.trim().length ?? 0) > 0

  if (!hasCondition) {
    throw new Error('A routing rule must have at least one match condition.')
  }
  if (payload.action === 'route' && payload.projectId == null) {
    throw new Error("A 'route' rule requires a projectId.")
  }

  const db = getDb()
  
  // Normalize whitespace-only values to NULL
  const normalizeValue = (val: string | null | undefined): string | null => {
    const trimmed = val?.trim() ?? ''
    return trimmed.length > 0 ? trimmed : null
  }
  
  const inserted = db
    .prepare(
      `INSERT INTO routing_rules
         (action, project_id, match_type, match_reason, match_repo_owner, match_repo_name, match_org)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(
      payload.action,
      payload.action === 'route' ? (payload.projectId ?? null) : null,
      normalizeValue(payload.matchType),
      normalizeValue(payload.matchReason),
      normalizeValue(payload.matchRepoOwner),
      normalizeValue(payload.matchRepoName),
      normalizeValue(payload.matchOrg),
    ) as Omit<RoutingRuleRow, 'project_name'>

  let projectName: string | null = null
  if (payload.action === 'route' && payload.projectId != null) {
    const project = db
      .prepare('SELECT name FROM projects WHERE id = ?')
      .get(payload.projectId) as { name: string } | undefined
    projectName = project?.name ?? null
  }

  return toRoutingRule({ ...inserted, project_name: projectName })
}

export function deleteRoutingRule(id: number): void {
  getDb().prepare('DELETE FROM routing_rules WHERE id = ?').run(id)
}

// ── Repo -> project resolution (shared with the `add_todo` MCP tool) ───────────

/**
 * Resolve a bare `owner/name` repo to the project it should land in, mirroring the exact
 * precedence `upsertThreads` applies to notifications: (1) an exact `repo_rules` entry claims
 * the repo (and resolves to the Inbox if its target project is soft-deleted — it does NOT fall
 * through); (2) otherwise the `route` routing rules, first match wins, evaluated through the
 * SAME `routingRuleMatches` matcher via a repo-only pseudo-thread (empty type/reason, so a
 * type/reason-conditioned rule simply won't match — correct, since a bare repo carries neither);
 * (3) otherwise the Inbox (`null`). We reuse the matcher rather than reinventing it, but do NOT
 * route notifications through here — those legitimately need type/reason matching.
 */
export function resolveProjectIdForRepo(repoOwner: string, repoName: string): number | null {
  const db = getDb()
  const liveProjectIds = new Set(
    (db.prepare('SELECT id FROM projects WHERE deleted_at IS NULL').all() as { id: number }[]).map((r) => r.id)
  )

  const repoRule = db
    .prepare(
      // GitHub owner/name are case-insensitive, and Copilot may send `repo` with different
      // casing than the stored canonical form, so match case-insensitively.
      'SELECT project_id FROM repo_rules WHERE lower(repo_owner) = lower(?) AND lower(repo_name) = lower(?) LIMIT 1'
    )
    .get(repoOwner, repoName) as { project_id: number } | undefined
  if (repoRule != null) {
    // A repo rule claims the repo even when its target is dead — matching upsertThreads,
    // which then gates a dead target down to the Inbox rather than trying routing rules.
    return liveProjectIds.has(repoRule.project_id) ? repoRule.project_id : null
  }

  const routeRules = listRoutingRules().filter(
    (r) => r.action === 'route' && r.projectId !== null && liveProjectIds.has(r.projectId)
  )
  const pseudoThread: NotificationThread = {
    id: '',
    projectId: null,
    repoOwner,
    repoName,
    title: '',
    type: '' as NotificationThread['type'],
    reason: '',
    unread: false,
    updatedAt: '',
    lastReadAt: null,
    apiUrl: '',
    subjectUrl: null,
    subjectState: null,
    htmlUrl: null,
  }
  for (const rule of routeRules) {
    if (routingRuleMatches(rule, pseudoThread)) {
      return rule.projectId
    }
  }

  return null
}

/**
 * Resolve an explicit project name to a live project id. Case-insensitive exact match;
 * lowest id wins on the (rare) duplicate-name tie. Returns `null` when no live project matches.
 */
export function resolveProjectIdByName(name: string): number | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return null
  const row = getDb()
    .prepare(
      `SELECT id FROM projects
       WHERE deleted_at IS NULL AND lower(name) = lower(?)
       ORDER BY id ASC
       LIMIT 1`
    )
    .get(trimmed) as { id: number } | undefined
  return row?.id ?? null
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
 * Evaluates 'route' rules against every inbox thread (project_id IS NULL).
 * 'suppress' rules are read-time and do not need to be applied here.
 * Rules are evaluated in creation order; the first matching route rule wins.
 * Returns the number of threads that were routed.
 */
export function applyRoutingRulesToInbox(): { matched: number } {
  const db = getDb()

  // Only route to live (non-soft-deleted) projects.
  const liveProjectIds = new Set(
    (db.prepare('SELECT id FROM projects WHERE deleted_at IS NULL').all() as { id: number }[]).map((r) => r.id)
  )
  const rules = listRoutingRules().filter(
    (r) => r.action === 'route' && r.projectId !== null && liveProjectIds.has(r.projectId)
  )
  if (rules.length === 0) return { matched: 0 }

  return db.transaction(() => {
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

    const updateThread = db.prepare(
      `UPDATE notification_threads SET project_id = ? WHERE id = ?`
    )
    const wakeSnooze = db.prepare(
      `UPDATE projects
       SET status = 'active', snooze_mode = NULL, snooze_until = NULL, updated_at = datetime('now')
       WHERE id = ? AND status = 'snoozed' AND snooze_mode = 'notification'`
    )

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
          updateThread.run(rule.projectId, thread.id)
          if (rule.projectId != null) {
            wakeSnooze.run(rule.projectId)
          }
          matched++
          break // first match wins
        }
      }
    }

    return { matched }
  })()
}
