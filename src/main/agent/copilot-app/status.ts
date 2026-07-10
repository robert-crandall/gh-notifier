/**
 * Read delegated-session status from the Copilot desktop app's OWN sqlite
 * (`~/.copilot/data.db`), read-only, for the ids Focus created.
 *
 * Privacy + safety: we only ever SELECT `id, is_running` and only for the ids we
 * pass in (`WHERE id IN (...)`), so no other session's row or content is read,
 * and nothing is logged. The handle is opened read-only and always closed.
 *
 * Status mapping (verified against the app schema — sessions persist after
 * finishing, so there is no terminal "completed" signal):
 *   present & is_running = 1 -> in_progress  (working)
 *   present & is_running = 0 -> waiting       (idle / not running)
 *   absent (db readable)     -> unknown        (NOT "completed" — absence != done)
 * When the db can't be opened or is locked, the caller keeps the last-known
 * status; a schema drift (missing table/column) maps everything to unknown.
 *
 * `better-sqlite3` is imported LAZILY (dynamic import) so this module can be
 * loaded in tests without the native binding; the pure mapping + the refresh
 * orchestration are tested with an injected reader.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CopilotAppSessionStatus, TodoAppSession, CopilotAppSession } from '../../../shared/ipc-channels'
import { getTodoAppSessionsForProject, updateAppSessionStatus, getAppSessionsForProject } from './store'

/** Path to the desktop app's own sqlite database. */
export function copilotDataDbPath(): string {
  return join(homedir(), '.copilot', 'data.db')
}

export type AppStatusRead =
  /** Statuses read: present ids mapped, absent ids -> 'unknown'. */
  | { ok: true; statuses: Map<string, CopilotAppSessionStatus> }
  /** Transient (app closed / db locked): the caller should keep last-known status. */
  | { ok: false }

/** A status reader (injectable for tests). */
export type AppStatusReader = (ids: string[]) => Promise<AppStatusRead>

const CHUNK = 400 // keep well under SQLite's default 999-variable limit

/** Pure: map raw {id, is_running} rows to statuses; absent ids -> 'unknown'. */
export function mapRunningRows(
  ids: string[],
  rows: { id: string; is_running: number }[]
): Map<string, CopilotAppSessionStatus> {
  const present = new Map<string, CopilotAppSessionStatus>(
    rows.map((r) => [r.id, r.is_running ? 'in_progress' : 'waiting'])
  )
  const out = new Map<string, CopilotAppSessionStatus>()
  for (const id of ids) out.set(id, present.get(id) ?? 'unknown')
  return out
}

/**
 * Default reader: opens the app's data.db read-only and reads is_running for our
 * ids. See the module doc for the failure contract. Lazily loads better-sqlite3.
 */
export async function readAppSessionStatuses(
  ids: string[],
  dbPath: string = copilotDataDbPath()
): Promise<AppStatusRead> {
  if (ids.length === 0) return { ok: true, statuses: new Map() }

  const { default: Database } = await import('better-sqlite3')
  let db: import('better-sqlite3').Database
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
  } catch {
    return { ok: false } // app not running / file missing -> keep last-known
  }

  try {
    const rows: { id: string; is_running: number }[] = []
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK)
      const placeholders = chunk.map(() => '?').join(',')
      const got = db
        .prepare(`SELECT id, is_running FROM sessions WHERE id IN (${placeholders})`)
        .all(...chunk) as { id: string; is_running: number }[]
      rows.push(...got)
    }
    return { ok: true, statuses: mapRunningRows(ids, rows) }
  } catch (err) {
    const code = (err as { code?: string }).code ?? ''
    // A locked/busy db is transient — keep last-known. A missing table/column
    // (schema drift) means we genuinely can't tell -> unknown for all.
    if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') return { ok: false }
    return { ok: true, statuses: new Map(ids.map((id) => [id, 'unknown'])) }
  } finally {
    try {
      db.close()
    } catch {
      /* ignore */
    }
  }
}

/**
 * Refresh the stored status of every app session linked to a project's todos
 * from the app's data.db, then return the (todo, session) pairs. On a transient
 * read failure the stored (last-known) status is kept. `reader` is injectable
 * for tests.
 */
export async function refreshTodoAppSessionsForProject(
  projectId: number,
  reader: AppStatusReader = readAppSessionStatuses
): Promise<TodoAppSession[]> {
  const links = getTodoAppSessionsForProject(projectId)
  const ids = [...new Set(links.map((l) => l.session.id))]
  const read = await reader(ids)
  if (!read.ok) return links // transient failure -> last-known

  // Only write when the status actually changed, so 20s polling doesn't bump
  // updated_at (and reorder sessions) on every refresh.
  const current = new Map(links.map((l) => [l.session.id, l.session.status]))
  let changed = false
  for (const [id, status] of read.statuses) {
    if (current.get(id) !== status) {
      updateAppSessionStatus(id, status)
      changed = true
    }
  }
  return changed ? getTodoAppSessionsForProject(projectId) : links
}

/**
 * Return ALL app sessions for a project (both Projects-'launched' and directly-
 * 'observed', #119), newest first, after refreshing their live status from the
 * app's local store (read-only). Mirrors `refreshTodoAppSessionsForProject` but
 * keyed on project assignment rather than a todo link, so observed sessions —
 * which have no todo — surface too. On a transient read failure the stored
 * (last-known) status is kept. `reader` is injectable for tests.
 */
export async function refreshProjectAppSessions(
  projectId: number,
  reader: AppStatusReader = readAppSessionStatuses
): Promise<CopilotAppSession[]> {
  const sessions = getAppSessionsForProject(projectId)
  const ids = [...new Set(sessions.map((s) => s.id))]
  const read = await reader(ids)
  if (!read.ok) return sessions // transient failure → last-known

  // Only write when the status actually changed, so polling doesn't bump
  // updated_at (and reorder sessions) on every refresh.
  const current = new Map(sessions.map((s) => [s.id, s.status]))
  let changed = false
  for (const [id, status] of read.statuses) {
    if (current.get(id) !== status) {
      updateAppSessionStatus(id, status)
      changed = true
    }
  }
  return changed ? getAppSessionsForProject(projectId) : sessions
}
