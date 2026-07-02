import { useRef, useState } from 'react'
import { MoreHorizontal, Moon, Trash2, Sun } from 'lucide-react'
import type { LaunchTarget, Project, ProjectLink, ProjectTodo } from '@shared/ipc-channels'
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
    createLink,
    deleteLink,
  } = useProjectDetail(props.projectId, props.onProjectChanged)
  const { digest, dismiss } = useDigest(props.projectId)
  const [menuOpen, setMenuOpen] = useState(false)
  const [delegate, setDelegate] = useState<{ prompt: string; fixedRepo?: LaunchTarget } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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

  const handleDeleteLink = (link: ProjectLink): void => {
    fire(deleteLink(link.id))
    props.showUndo('Resource removed', () => fire(createLink(link.label, link.url)))
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
        onCreateLink={(label, url) => fire(createLink(label, url))}
        onDeleteLink={handleDeleteLink}
        onDelegate={(prompt, fixedRepo) => setDelegate({ prompt, fixedRepo })}
      />

      <div className={styles.tail} />

      {delegate && (
        <DelegateComposer
          initialPrompt={delegate.prompt}
          projectId={props.projectId}
          fixedRepo={delegate.fixedRepo}
          onClose={() => setDelegate(null)}
          onLaunched={(session) => {
            props.showUndo(
              'Copilot is on it — I’ll fold the result into your digest.',
              () => { if (session.htmlUrl) openExternal(session.htmlUrl) },
              'Open'
            )
          }}
        />
      )}
    </main>
  )
}
