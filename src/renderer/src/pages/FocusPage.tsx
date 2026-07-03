import { useEffect, useMemo, useRef, useState } from 'react'
import { MoreHorizontal, Moon, Trash2, Sun, BellRing } from 'lucide-react'
import type { CopilotAppSession, LaunchTarget, Project, ProjectTodo, TodoAppSession } from '@shared/ipc-channels'
import { Icon } from '../components/Icon'
import { ReentryDigest } from '../components/ReentryDigest'
import { NextAction } from '../components/NextAction'
import { WorkingColumn } from '../components/WorkingColumn'
import { DelegateComposer } from '../components/DelegateComposer'
import { ResurfaceStrip } from '../components/ResurfaceStrip'
import { fire, openExternal } from '../ipc'
import { useProjectDetail } from '../hooks/useProjectDetail'
import { useDigest } from '../hooks/useDigest'
import styles from './FocusPage.module.css'

interface FocusPageProps {
  projectId: number
  onProjectChanged: () => void
  showUndo: (message: string, onUndo: () => void, actionLabel?: string) => void
  drifting: Project[]
  onSelectProject: (id: number) => void
  onPark: (project: Project) => void
  onSnooze: (project: Project) => void
  onNotNow: (project: Project) => void
  onSnoozeCurrent: () => void
  onSnoozeCurrentUntilNotification: () => void
  onDeleteCurrent: () => void
}

export function FocusPage(props: FocusPageProps): JSX.Element {
  const {
    detail,
    isLoading,
    updateProject,
    createTodo,
    updateTodo,
    deleteTodo,
    restoreTodo,
  } = useProjectDetail(props.projectId, props.onProjectChanged)
  const { digest, dismiss } = useDigest(props.projectId)
  const [menuOpen, setMenuOpen] = useState(false)
  const [delegate, setDelegate] = useState<{ prompt: string; fixedRepo?: LaunchTarget; todoId?: number } | null>(null)
  const [appSessions, setAppSessions] = useState<TodoAppSession[]>([])
  const menuRef = useRef<HTMLDivElement>(null)

  // Load + refresh the delegated app sessions on this project's todos (#87): on
  // project change, on window focus, and on a light interval while mounted.
  const projectId = props.projectId
  useEffect(() => {
    let active = true
    const load = async (): Promise<void> => {
      try {
        const list = await window.electron.ipc.invoke('copilot:app-sessions-for-project', projectId)
        if (active) setAppSessions(list)
      } catch (err) {
        console.error('[FocusPage] Failed to load app sessions:', err)
      }
    }
    void load()
    const onFocus = (): void => { void load() }
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => { void load() }, 20000)
    return () => {
      active = false
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [projectId])

  const appSessionsByTodo = useMemo(() => {
    const map = new Map<number, CopilotAppSession[]>()
    for (const { todoId, session } of appSessions) {
      const list = map.get(todoId)
      if (list) list.push(session)
      else map.set(todoId, [session])
    }
    return map
  }, [appSessions])

  const reloadAppSessions = async (): Promise<void> => {
    try {
      setAppSessions(await window.electron.ipc.invoke('copilot:app-sessions-for-project', projectId))
    } catch (err) {
      console.error('[FocusPage] Failed to reload app sessions:', err)
    }
  }

  if (isLoading || detail === null) {
    return <main className={styles.main} />
  }

  const handleDone = (): void => {
    const previous = detail.nextAction
    if (previous.trim().length === 0) return
    fire(updateProject({ nextAction: '' }))
    props.showUndo('Marked done', () => fire(updateProject({ nextAction: previous })))
  }

  const handleDeleteTodo = (todo: ProjectTodo): void => {
    fire(deleteTodo(todo.id))
    props.showUndo('Todo removed', () => fire(restoreTodo(todo.id)))
  }

  return (
    <main className={styles.main}>
      {digest && <ReentryDigest digest={digest} onDismiss={dismiss} />}

      <div className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{detail.name}</h1>
            <span className={`${styles.pill} ${detail.status === 'snoozed' ? styles.pillSnoozed : styles.pillActive}`}>
              <span className={styles.pillDot} />
              {detail.status}
            </span>
          </div>
          {detail.notes.trim().length > 0 && <p className={styles.notes}>{detail.notes}</p>}
        </div>
        <div className={styles.menuWrap} ref={menuRef}>
          <button type="button" className={styles.menuButton} onClick={() => setMenuOpen((v) => !v)} aria-label="Project actions">
            <Icon icon={MoreHorizontal} size={16} />
          </button>
          {menuOpen && (
            <>
              <div className={styles.menuBackdrop} onClick={() => setMenuOpen(false)} />
              <div className={styles.menu}>
                {detail.status === 'snoozed' ? (
                  <button type="button"
                    className={styles.menuItem}
                    onClick={() => {
                      setMenuOpen(false)
                      fire(updateProject({ status: 'active' }))
                    }}
                  >
                    <Icon icon={Sun} size={14} />
                    Resume project
                  </button>
                ) : (
                  <button type="button"
                    className={styles.menuItem}
                    onClick={() => {
                      setMenuOpen(false)
                      props.onSnoozeCurrent()
                    }}
                  >
                    <Icon icon={Moon} size={14} />
                    Snooze project
                  </button>
                )}
                {detail.status !== 'snoozed' && (
                  <button type="button"
                    className={styles.menuItem}
                    onClick={() => {
                      setMenuOpen(false)
                      props.onSnoozeCurrentUntilNotification()
                    }}
                  >
                    <Icon icon={BellRing} size={14} />
                    Snooze until a notification
                  </button>
                )}
                <button type="button"
                  className={`${styles.menuItem} ${styles.menuDanger}`}
                  onClick={() => {
                    setMenuOpen(false)
                    props.onDeleteCurrent()
                  }}
                >
                  <Icon icon={Trash2} size={14} />
                  Delete project
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <NextAction
        value={detail.nextAction}
        onSave={(text) => fire(updateProject({ nextAction: text }))}
        onDone={handleDone}
        onDelegate={(prompt) => setDelegate({ prompt })}
      />

      <ResurfaceStrip
        drifting={props.drifting}
        onSelect={props.onSelectProject}
        onPark={props.onPark}
        onSnooze={props.onSnooze}
        onNotNow={props.onNotNow}
      />

      <WorkingColumn
        detail={detail}
        onCreateTodo={(text) => fire(createTodo(text))}
        onToggleTodo={(todo) => fire(updateTodo(todo.id, { done: !todo.done }))}
        onDeleteTodo={handleDeleteTodo}
        onSaveNotes={(notes) => fire(updateProject({ notes }))}
        onDelegate={(prompt, fixedRepo, todoId) => setDelegate({ prompt, fixedRepo, todoId })}
        appSessionsByTodo={appSessionsByTodo}
        showUndo={props.showUndo}
      />

      <div className={styles.tail} />

      {delegate && (
        <DelegateComposer
          initialPrompt={delegate.prompt}
          projectId={props.projectId}
          fixedRepo={delegate.fixedRepo}
          onClose={() => setDelegate(null)}
          onLaunched={(result) => {
            if (result.kind === 'cloud') {
              props.showUndo(
                'Copilot is on it — I’ll fold the result into your digest.',
                () => { if (result.session.htmlUrl) openExternal(result.session.htmlUrl) },
                'Open'
              )
            } else {
              // App session: link it to the originating todo (#87) so its live
              // status shows there, then refresh the todo chips.
              const todoId = delegate.todoId
              if (todoId !== undefined) {
                void (async () => {
                  try {
                    await window.electron.ipc.invoke('todos:link-session', todoId, result.session.id)
                    await reloadAppSessions()
                  } catch (err) {
                    console.error('[FocusPage] Failed to link app session to todo:', err)
                  }
                })()
              }
              const message =
                result.kind === 'app-send-failed'
                  ? 'Opened a Copilot session, but I couldn’t hand off the task — open it to retry.'
                  : 'Copilot is on it in the desktop app.'
              props.showUndo(
                message,
                () => { fire(window.electron.ipc.invoke('copilot:open-app-session', result.session.id), 'copilot:open-app-session') },
                'Open'
              )
            }
          }}
        />
      )}
    </main>
  )
}
