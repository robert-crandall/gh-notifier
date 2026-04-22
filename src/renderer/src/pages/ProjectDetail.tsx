import { useState, useRef, useEffect } from 'react'
import styles from './ProjectDetail.module.css'
import { useProjectDetail } from '../hooks/useProjectDetail'
import type { ProjectLink } from '@shared/ipc-channels'

type Tab = 'todos' | 'notes' | 'notifications'

interface Props {
  projectId: number
  onBack: () => void
  onProjectChanged: () => void
}

export function ProjectDetail({ projectId, onBack, onProjectChanged }: Props) {
  const {
    detail,
    isLoading,
    updateProject,
    createTodo,
    updateTodo,
    deleteTodo,
    createLink,
    deleteLink,
  } = useProjectDetail(projectId, onProjectChanged)

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    return (localStorage.getItem(`tab:${projectId}`) as Tab | null) ?? 'todos'
  })

  const [editingAction, setEditingAction] = useState(false)
  const [actionDraft, setActionDraft] = useState('')
  const actionRef = useRef<HTMLTextAreaElement>(null)

  const [newTodoText, setNewTodoText] = useState('')
  const [showLinkForm, setShowLinkForm] = useState(false)
  const [linkLabel, setLinkLabel] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [notesDraft, setNotesDraft] = useState<string | null>(null)

  useEffect(() => {
    if (editingAction && actionRef.current) {
      actionRef.current.focus()
      actionRef.current.setSelectionRange(
        actionRef.current.value.length,
        actionRef.current.value.length
      )
    }
  }, [editingAction])

  useEffect(() => {
    localStorage.setItem(`tab:${projectId}`, activeTab)
  }, [activeTab, projectId])

  if (isLoading || !detail) {
    return <div className={styles.main}><div className={styles.loadingState}>Loading…</div></div>
  }

  const activeTodos = detail.todos.filter((t) => !t.done)
  const doneTodos = detail.todos.filter((t) => t.done)

  const handleActionSave = async () => {
    setEditingAction(false)
    if (actionDraft !== detail.nextAction) {
      await updateProject({ nextAction: actionDraft })
    }
  }

  const handleTodoAdd = async () => {
    const text = newTodoText.trim()
    if (!text) return
    setNewTodoText('')
    await createTodo(text)
  }

  const handleNotesSave = async () => {
    if (notesDraft !== null && notesDraft !== detail.notes) {
      await updateProject({ notes: notesDraft })
    }
    setNotesDraft(null)
  }

  const handleLinkAdd = async () => {
    const label = linkLabel.trim()
    const url = linkUrl.trim()
    if (!label || !url) return
    await createLink(label, url)
    setLinkLabel('')
    setLinkUrl('')
    setShowLinkForm(false)
  }

  return (
    <div className={styles.main}>
      {/* Toolbar */}
      <header className={styles.toolbar}>
        <div className={styles.breadcrumb}>
          <button className={styles.breadcrumbBack} onClick={onBack}>
            Projects
          </button>
          <span className={styles.breadcrumbSep}>/</span>
          <span className={styles.breadcrumbCurrent}>{detail.name}</span>
        </div>
        <div className={styles.toolbarActions}>
          <button
            className={styles.actionButton}
            onClick={() => updateProject({ status: detail.status === 'snoozed' ? 'active' : 'snoozed' })}
          >
            {detail.status === 'snoozed' ? 'Unsnooze' : 'Snooze'}
          </button>
        </div>
      </header>

      <div className={styles.content}>
        {/* Next Action Banner */}
        <div className={styles.nextActionBanner}>
          <div className={styles.focusLabel}>
            <svg width="8" height="9" viewBox="0 0 8 9" fill="none" aria-hidden="true">
              <path d="M1 1l6 3.5L1 8V1z" fill="rgba(255,255,255,0.5)" />
            </svg>
            <span>NEXT ACTION</span>
          </div>

          {editingAction ? (
            <textarea
              ref={actionRef}
              className={styles.actionTextarea}
              value={actionDraft}
              onChange={(e) => setActionDraft(e.target.value)}
              onBlur={handleActionSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleActionSave() }
                if (e.key === 'Escape') { setEditingAction(false); setActionDraft(detail.nextAction) }
              }}
              rows={2}
              placeholder="What's the next step?"
            />
          ) : (
            <button
              className={styles.actionText}
              onClick={() => { setActionDraft(detail.nextAction); setEditingAction(true) }}
            >
              {detail.nextAction || <span className={styles.actionPlaceholder}>Set a next action…</span>}
            </button>
          )}

          <div className={styles.actionMeta}>
            <button className={styles.actionMetaBtn} onClick={() => { setActionDraft(detail.nextAction); setEditingAction(true) }}>Edit</button>
            <span className={styles.actionMetaDot}>·</span>
            <button className={styles.actionMetaBtn} onClick={() => updateProject({ nextAction: '' })}>Mark done</button>
          </div>
        </div>

        {/* Links strip */}
        <div className={styles.linksStrip}>
          <span className={styles.linksLabel}>LINKS</span>
          <div className={styles.linksPills}>
            {detail.links.map((link: ProjectLink) => (
              <div key={link.id} className={styles.linkPillWrap}>
                <button
                  className={styles.linkPill}
                  onClick={() => window.electron.openExternal(link.url)}
                  title={link.url}
                >
                  {link.label}
                </button>
                <button
                  className={styles.linkDelete}
                  onClick={() => deleteLink(link.id)}
                  aria-label={`Remove ${link.label}`}
                >
                  ×
                </button>
              </div>
            ))}

            {showLinkForm ? (
              <div className={styles.linkForm}>
                <input
                  className={styles.linkInput}
                  autoFocus
                  placeholder="Label"
                  value={linkLabel}
                  onChange={(e) => setLinkLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleLinkAdd(); if (e.key === 'Escape') setShowLinkForm(false) }}
                />
                <input
                  className={styles.linkInput}
                  placeholder="https://…"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleLinkAdd(); if (e.key === 'Escape') setShowLinkForm(false) }}
                />
                <button className={styles.linkSaveBtn} onClick={handleLinkAdd}>Add</button>
                <button className={styles.linkCancelBtn} onClick={() => setShowLinkForm(false)}>Cancel</button>
              </div>
            ) : (
              <button className={styles.addLinkBtn} onClick={() => setShowLinkForm(true)}>
                + Add
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          {(['todos', 'notes', 'notifications'] as Tab[]).map((tab) => (
            <button
              key={tab}
              className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className={styles.tabContent}>
          {activeTab === 'todos' && (
            <div className={styles.todoList}>
              {activeTodos.map((todo) => (
                <div key={todo.id} className={styles.todoRow}>
                  <button
                    className={styles.checkbox}
                    onClick={() => updateTodo(todo.id, { done: true })}
                    aria-label="Mark complete"
                  />
                  <span className={styles.todoText}>{todo.text}</span>
                  <button
                    className={styles.todoDelete}
                    onClick={() => deleteTodo(todo.id)}
                    aria-label="Delete todo"
                  >
                    ×
                  </button>
                </div>
              ))}

              {doneTodos.map((todo) => (
                <div key={todo.id} className={`${styles.todoRow} ${styles.done}`}>
                  <button
                    className={`${styles.checkbox} ${styles.checkboxDone}`}
                    onClick={() => updateTodo(todo.id, { done: false })}
                    aria-label="Mark incomplete"
                  >
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
                      <path d="M1 3l3 3 5-5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <span className={`${styles.todoText} ${styles.todoTextDone}`}>{todo.text}</span>
                  <button
                    className={styles.todoDelete}
                    onClick={() => deleteTodo(todo.id)}
                    aria-label="Delete todo"
                  >
                    ×
                  </button>
                </div>
              ))}

              {/* Add task row */}
              <div className={styles.addTodoRow}>
                <input
                  className={styles.addTodoInput}
                  placeholder="+ Add task"
                  value={newTodoText}
                  onChange={(e) => setNewTodoText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleTodoAdd() }}
                />
              </div>
            </div>
          )}

          {activeTab === 'notes' && (
            <div className={styles.notesArea}>
              <textarea
                className={styles.notesTextarea}
                value={notesDraft ?? detail.notes}
                onChange={(e) => setNotesDraft(e.target.value)}
                onBlur={handleNotesSave}
                placeholder="Free-form notes, context, requirements…"
              />
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className={styles.notificationsEmpty}>
              <p>Notifications will appear here in a future milestone.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
