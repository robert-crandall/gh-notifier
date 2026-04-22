import type { NotificationFilter, FilterDimension, FilterScope, NotificationThread } from '../../shared/ipc-channels'
import { getDb } from './index'

// ── Row types ─────────────────────────────────────────────────────────────────

interface FilterRow {
  id: number
  dimension: string
  value: string
  scope: string
  scope_owner: string | null
  scope_repo: string | null
  created_at: string
}

// ── Row → domain mapper ───────────────────────────────────────────────────────

function toFilter(row: FilterRow): NotificationFilter {
  return {
    id: row.id,
    dimension: row.dimension as FilterDimension,
    value: row.value,
    scope: row.scope as FilterScope,
    scopeOwner: row.scope_owner,
    scopeRepo: row.scope_repo,
    createdAt: row.created_at,
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function listFilters(): NotificationFilter[] {
  const rows = getDb()
    .prepare('SELECT * FROM filters ORDER BY created_at ASC')
    .all() as FilterRow[]
  return rows.map(toFilter)
}

export function createFilter(
  dimension: FilterDimension,
  value: string,
  scope: FilterScope = 'global',
  scopeOwner?: string,
  scopeRepo?: string,
): NotificationFilter {
  const db = getDb()
  const result = db
    .prepare(
      `INSERT INTO filters (dimension, value, scope, scope_owner, scope_repo)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(
      dimension,
      value.trim(),
      scope,
      scopeOwner ?? null,
      scopeRepo ?? null,
    ) as FilterRow
  return toFilter(result)
}

export function deleteFilter(id: number): void {
  getDb().prepare('DELETE FROM filters WHERE id = ?').run(id)
}

// ── Filter evaluation ─────────────────────────────────────────────────────────

/**
 * Returns true if the thread should be suppressed by the given filter.
 * Matching rules:
 * - author:  case-insensitive substring match against title (best effort without content fetch)
 * - org:     case-insensitive substring match against repoOwner
 * - repo:    case-insensitive substring match against repoName
 * - reason:  exact match (case-insensitive) against reason
 * - state:   exact match (case-insensitive) against subjectState (null = no match)
 * - type:    exact match (case-insensitive) against type
 */
function filterMatches(filter: NotificationFilter, thread: NotificationThread): boolean {
  const needle = filter.value.toLowerCase()

  switch (filter.dimension) {
    case 'author':
      // Note: The true author field is not available from the notifications list endpoint
      // at sync time, so this filter matches against the title substring as a best-effort
      // heuristic (e.g., "[bot]" in title). For more accurate author filtering, thread
      // data would need to be enriched during prefetch.
      return thread.title.toLowerCase().includes(needle)

    case 'org':
      return thread.repoOwner.toLowerCase().includes(needle)

    case 'repo':
      return thread.repoName.toLowerCase().includes(needle)

    case 'reason':
      return thread.reason.toLowerCase() === needle

    case 'state':
      // subjectState is only populated after content prefetch; skip if null
      return thread.subjectState != null && thread.subjectState.toLowerCase() === needle

    case 'type':
      return thread.type.toLowerCase() === needle

    default:
      return false
  }
}

/**
 * Returns true if the thread should be suppressed given the full set of
 * active filters.
 *
 * - Global filters (any dimension): suppress if matched.
 * - Per-repo filters (any dimension): suppress if the thread is from that
 *   specific repo and the filter matches. Additive to global rules —
 *   a per-repo filter can never un-suppress something a global filter catches.
 *
 * A single matching filter is sufficient to suppress (OR semantics across
 * independent filter rules).
 */
export function shouldSuppress(thread: NotificationThread, filters: NotificationFilter[]): boolean {
  for (const filter of filters) {
    if (filter.scope === 'global') {
      if (filterMatches(filter, thread)) return true
    } else {
      // Per-repo filter: only applies when the thread is from that specific repo
      const repoMatches =
        filter.scopeOwner != null &&
        filter.scopeRepo != null &&
        thread.repoOwner.toLowerCase() === filter.scopeOwner.toLowerCase() &&
        thread.repoName.toLowerCase() === filter.scopeRepo.toLowerCase()
      if (repoMatches && filterMatches(filter, thread)) return true
    }
  }
  return false
}
