import { useCallback, useEffect, useRef, useState } from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { Sparkles, GitPullRequest, PauseCircle, CheckCircle2, ExternalLink } from 'lucide-react'
import type { CopilotSession, CopilotSessionStatus, Project, RepoRuleSuggestion } from '@shared/ipc-channels'
import type { LucideIcon } from 'lucide-react'
import { Icon } from '../components/Icon'
import { openExternal } from '../ipc'
import styles from './AgentTasksView.module.css'

const STATUS_META: Record<CopilotSessionStatus, { label: string; icon: LucideIcon; tone: string }> = {
  in_progress: { label: 'Working', icon: Sparkles, tone: styles.toneAgent },
  waiting: { label: 'Needs you', icon: PauseCircle, tone: styles.toneAttention },
  pr_ready: { label: 'PR ready', icon: GitPullRequest, tone: styles.toneAttention },
  completed: { label: 'Done', icon: CheckCircle2, tone: styles.toneQuiet },
}

function relativeTime(iso: string): string {
  try {
    const parsed = parseISO(iso)
    return Number.isNaN(parsed.getTime()) ? '' : formatDistanceToNow(parsed, { addSuffix: true })
  } catch {
    return ''
  }
}

function SessionRow({
  session,
  projects,
  onAssign,
}: {
  session: CopilotSession
  projects: Project[]
  onAssign: (sessionId: string, projectId: number) => void
}): JSX.Element {
  const meta = STATUS_META[session.status]
  return (
    <div className={styles.row}>
      <span className={`${styles.status} ${meta.tone}`} title={meta.label}>
        <Icon icon={meta.icon} size={15} />
      </span>
      <div className={styles.body}>
        <div className={styles.title}>{session.title || 'Untitled task'}</div>
        <div className={styles.meta}>
          {session.repoOwner && session.repoName ? `${session.repoOwner}/${session.repoName} · ` : ''}
          {meta.label} · {relativeTime(session.updatedAt)}
        </div>
      </div>
      <select
        className={styles.assign}
        value=""
        aria-label={`Assign "${session.title || 'Untitled task'}" to a project`}
        onChange={(e) => e.target.value && onAssign(session.id, Number(e.target.value))}
      >
        <option value="">Assign…</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      {session.htmlUrl && (
        <button
          type="button"
          className={styles.rowAction}
          onClick={() => openExternal(session.htmlUrl as string)}
          aria-label="Open on GitHub"
        >
          <Icon icon={ExternalLink} size={14} />
        </button>
      )}
    </div>
  )
}

export function AgentTasksView(): JSX.Element {
  const [sessions, setSessions] = useState<CopilotSession[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [suggestion, setSuggestion] = useState<RepoRuleSuggestion | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async () => {
    try {
      const [unassigned, projectList] = await Promise.all([
        window.electron.ipc.invoke('copilot:unassigned'),
        window.electron.ipc.invoke('projects:list'),
      ])
      if (!mountedRef.current) return
      setSessions(unassigned)
      setProjects(projectList.filter((p) => p.status === 'active'))
    } catch (err) {
      console.error('[AgentTasks] Failed to load:', err)
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const unsub = window.electron.onCopilotUpdated(() => { void load() })
    return unsub
  }, [load])

  const handleAssign = useCallback(async (sessionId: string, projectId: number) => {
    try {
      const result = await window.electron.ipc.invoke('copilot:assign', sessionId, projectId)
      if (!mountedRef.current) return
      // Offer to remember the repo → project mapping so future sessions in this
      // repo auto-assign. A null result (repo already has a live mapping) also
      // clears any stale banner from a previous assignment.
      setSuggestion(result)
      // Optimistically drop it from the list; the push event reconciles the rest.
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
    } catch (err) {
      console.error('[AgentTasks] Assign failed:', err)
    }
  }, [])

  const acceptRule = useCallback(async () => {
    if (!suggestion) return
    try {
      await window.electron.ipc.invoke('repo-rules:create', suggestion.repoOwner, suggestion.repoName, suggestion.projectId)
    } catch (err) {
      console.error('[AgentTasks] Repo rule creation failed:', err)
    }
    if (mountedRef.current) setSuggestion(null)
  }, [suggestion])

  const active = sessions.filter((s) => s.status !== 'completed')
  const completed = sessions.filter((s) => s.status === 'completed')

  return (
    <main className={styles.main}>
      <header className={styles.toolbar}>
        <span className={styles.heading}>Agent tasks</span>
        <span className={styles.sub}>Copilot sessions not tied to a project</span>
      </header>

      {suggestion && (
        <div className={styles.suggestion}>
          <span>
            Always route {suggestion.repoOwner}/{suggestion.repoName} to &ldquo;{suggestion.projectName}&rdquo;?
          </span>
          <div className={styles.suggestionActions}>
            <button type="button" className={styles.accept} onClick={() => void acceptRule()}>Remember repo</button>
            <button type="button" className={styles.dismiss} onClick={() => setSuggestion(null)}>No thanks</button>
          </div>
        </div>
      )}

      <div className={styles.content}>
        {isLoading && <div className={styles.empty}>Loading…</div>}
        {!isLoading && sessions.length === 0 && (
          <div className={styles.empty}>No unassigned agent tasks. Everything Copilot is doing is tied to a project.</div>
        )}

        {active.length > 0 && (
          <>
            <div className={styles.sectionLabel}>Active</div>
            {active.map((s) => (
              <SessionRow key={s.id} session={s} projects={projects} onAssign={(id, pid) => void handleAssign(id, pid)} />
            ))}
          </>
        )}

        {completed.length > 0 && (
          <>
            <div className={styles.sectionLabel}>Recently completed</div>
            {completed.map((s) => (
              <SessionRow key={s.id} session={s} projects={projects} onAssign={(id, pid) => void handleAssign(id, pid)} />
            ))}
          </>
        )}
      </div>
    </main>
  )
}
