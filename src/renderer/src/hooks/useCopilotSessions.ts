import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CopilotSession,
  CopilotAppSession,
  CopilotSessionStatus,
  CopilotAppSessionStatus,
  CopilotAppSessionOrigin,
} from '@shared/ipc-channels'
import { parseDbTimestampMs } from '@shared/time'
import { parseSafeExternalUrl } from '@shared/safe-url'

/**
 * Per-project Copilot sessions for the project working view (#117). Merges the two
 * already-exposed per-project readers - cloud `gh agent-task` sessions
 * (`copilot:sessions-for-project`) and desktop-app sessions
 * (`copilot:project-app-sessions`, both launched + observed) - into one unified,
 * newest-activity-first list, and keeps it live on the `copilot:updated` push event.
 */

export type CopilotRowKind = 'cloud' | 'app'

/** The union of both source status vocabularies (cloud adds `pr_ready`, app adds `unknown`). */
export type CopilotRowStatus = CopilotSessionStatus | CopilotAppSessionStatus

export interface CopilotSessionRow {
  /** Stable, source-prefixed key; the two UUID namespaces could otherwise collide. */
  key: string
  kind: CopilotRowKind
  title: string
  status: CopilotRowStatus
  /** Raw "started" timestamp for display (cloud `startedAt` / app `createdAt`). */
  startedAt: string
  /** Epoch ms of last activity, for sorting. NaN when unparseable (sorts last). */
  updatedAtMs: number
  /** Cloud open target: the first of `linkedPrUrl`/`htmlUrl` that is a safe http(s) URL. */
  githubUrl: string | null
  /** App open target: the desktop session id, opened via `copilot:open-app-session`. */
  appSessionId: string | null
  /** App-only provenance hint (`launched` vs `observed`). */
  origin: CopilotAppSessionOrigin | null
}

function cloudRow(session: CopilotSession): CopilotSessionRow {
  return {
    key: `cloud:${session.id}`,
    kind: 'cloud',
    title: session.title,
    status: session.status,
    startedAt: session.startedAt,
    updatedAtMs: parseDbTimestampMs(session.updatedAt),
    // Prefer the PR link, but only take the first URL that is actually safe to open.
    githubUrl: parseSafeExternalUrl(session.linkedPrUrl) ?? parseSafeExternalUrl(session.htmlUrl),
    appSessionId: null,
    origin: null,
  }
}

function appRow(session: CopilotAppSession): CopilotSessionRow {
  return {
    key: `app:${session.id}`,
    kind: 'app',
    title: session.title,
    status: session.status,
    startedAt: session.createdAt,
    updatedAtMs: parseDbTimestampMs(session.updatedAt),
    githubUrl: null,
    appSessionId: session.id,
    origin: session.origin,
  }
}

// Unparseable timestamps sort as epoch 0 (oldest) rather than poisoning the comparator.
function sortKey(ms: number): number {
  return Number.isNaN(ms) ? 0 : ms
}

/** Merge the two per-project session sources into one list, newest activity first. */
export function mergeCopilotSessions(
  cloud: CopilotSession[],
  app: CopilotAppSession[]
): CopilotSessionRow[] {
  const rows = [...cloud.map(cloudRow), ...app.map(appRow)]
  rows.sort((a, b) => sortKey(b.updatedAtMs) - sortKey(a.updatedAtMs))
  return rows
}

interface CopilotSessionsState {
  projectId: number
  rows: CopilotSessionRow[]
  isLoading: boolean
  /** The last settled load had BOTH sources fulfilled (its emptiness is trustworthy). */
  authoritative: boolean
}

export interface UseCopilotSessionsResult {
  rows: CopilotSessionRow[]
  isLoading: boolean
  /**
   * True only after a load where BOTH sources succeeded AND the merged list is
   * empty. The one signal allowed to hide the tab / snap the user off it - a
   * transient or partial read failure must never read as "no sessions".
   */
  emptyIsAuthoritative: boolean
}

export function useCopilotSessions(projectId: number): UseCopilotSessionsResult {
  const [state, setState] = useState<CopilotSessionsState>({
    projectId,
    rows: [],
    isLoading: true,
    authoritative: false,
  })
  const mountedRef = useRef(true)
  const reqIdRef = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const reqId = ++reqIdRef.current
    const [cloudRes, appRes] = await Promise.allSettled([
      window.electron.ipc.invoke('copilot:sessions-for-project', projectId),
      window.electron.ipc.invoke('copilot:project-app-sessions', projectId),
    ])
    // Drop a superseded load or a post-unmount settle.
    if (!mountedRef.current || reqId !== reqIdRef.current) return

    if (cloudRes.status === 'fulfilled' && appRes.status === 'fulfilled') {
      // All-or-nothing: only a fully successful read may replace rows / be authoritative,
      // even when empty (that is a real "no sessions").
      setState({
        projectId,
        rows: mergeCopilotSessions(cloudRes.value, appRes.value),
        isLoading: false,
        authoritative: true,
      })
      return
    }

    if (cloudRes.status === 'rejected') {
      console.error('[Copilot] cloud sessions load failed:', cloudRes.reason)
    }
    if (appRes.status === 'rejected') {
      console.error('[Copilot] app sessions load failed:', appRes.reason)
    }
    // Preserve the prior snapshot for this project; a partial/total failure must
    // never blank the tab or read as an authoritative empty.
    setState((prev) =>
      prev.projectId === projectId
        ? { ...prev, isLoading: false, authoritative: false }
        : { projectId, rows: [], isLoading: false, authoritative: false }
    )
  }, [projectId])

  useEffect(() => {
    // Re-arm on setup so React.StrictMode's setup→cleanup→setup dev cycle doesn't
    // leave the ref permanently false and bail every subsequent load.
    mountedRef.current = true
    setState({ projectId, rows: [], isLoading: true, authoritative: false })
    void load()
    const unsub = window.electron.onCopilotUpdated(() => {
      void load()
    })
    const onFocus = (): void => {
      void load()
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void load()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      mountedRef.current = false
      unsub()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [projectId, load])

  // Render-time projectId guard: never surface another project's snapshot, and
  // ignore any setState written by a stale-projectId in-flight load. This closes
  // the one-paint window between a projectId change and the effect re-running.
  const matches = state.projectId === projectId
  const rows = matches ? state.rows : []
  const isLoading = matches ? state.isLoading : true
  const authoritative = matches ? state.authoritative : false

  return { rows, isLoading, emptyIsAuthoritative: authoritative && rows.length === 0 }
}
