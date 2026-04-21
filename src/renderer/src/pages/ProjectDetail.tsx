import { useState, useEffect, useRef } from 'react'
import type { Project, ProjectLink, ProjectTodo } from '../../../shared/types'
import styles from './ProjectDetail.module.css'

type Tab = 'todos' | 'notes'

interface ProjectDetailProps {
  project: Project
  onBack: () => void
  onUpdate: (id: number, changes: Partial<{ name: string; notes: string; nextAction: string; status: 'active' | 'snoozed' }>) => Promise<void>
}

export function ProjectDetail({ project, onBack, onUpdate }: ProjectDetailProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const saved = localStorage.getItem(`tab:${project.id}`)
    return (saved as Tab) ?? 'todos'
  })

  const [todos, setTodos] = useState<ProjectTodo[]>([])
  const [links, setLinks] = useState<ProjectLink[]>([])
  const [newTodoTitle, setNewTodoTitle] = useState('')
  const [newLinkLabel, setNewLinkLabel] = useState('')
  const [newLinkUrl, setNewLinkUrl] = useState('')
  const [addingLink, setAddingLink] = useState(false)
  const [editingNextAction, setEditingNextAction] = useState(false)
  const [nextActionDraft, setNextActionDraft] = useState(project.nextAction)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(project.name)

  const nextActionRef = useRef<HTMLTextAreaElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const newTodoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setNextActionDraft(project.nextAction)
    setNameDraft(project.name)
  }, [project])

  useEffect(() => {
    localStorage.setItem(`tab:${project.id}`, activeTab)
  }, [activeTab, project.id])

  // Load todos and links on mount / project change
  useEffect(() => {
    window.electron.ipc.invoke('todos:list', { projectId: project.id }).then(setTodos)
    window.electron.ipc.invoke('links:list', { projectId: project.id }).then(setLinks)
  }, [project.id])

  useEffect(() => {
    if (editingNextAction && nextActionRef.current) {
      nextActionRef.current.focus()
      nextActionRef.current.select()
    }
  }, [editingNextAction])

  useEffect(() => {
    if (editingName && nameRef.current) {
      nameRef.current.focus()
      nameRef.current.select()
    }
  }, [editingName])

  // ── Next action ─────────────────────────────────────────────────────────────

  async function commitNextAction(): Promise<void> {
    setEditingNextAction(false)
    if (nextActionDraft !== project.nextAction) {
      await onUpdate(project.id, { nextAction: nextActionDraft })
    }
  }

  async function commitName(): Promise<void> {
    setEditingName(false)
    const trimmed = nameDraft.trim()
    if (trimmed && trimmed !== project.name) {
      await onUpdate(project.id, { name: trimmed })
    } else {
      setNameDraft(project.name)
    }
  }

  // ── Todos ────────────────────────────────────────────────────────────────────

  async function handleAddTodo(): Promise<void> {
    const title = newTodoTitle.trim()
    if (!title) return
    const todo = await window.electron.ipc.invoke('todos:create', { projectId: project.id, title })
    setTodos((prev) => [...prev, todo])
    setNewTodoTitle('')
    newTodoRef.current?.focus()
  }

  async function handleToggleTodo(todo: ProjectTodo): Promise<void> {
    const updated = await window.electron.ipc.invoke('todos:update', {
      id: todo.id,
      changes: { done: !todo.done }
    })
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? updated : t)))
  }

  async function handleDeleteTodo(id: number): Promise<void> {
    await window.electron.ipc.invoke('todos:delete', { id })
    setTodos((prev) => prev.filter((t) => t.id !== id))
  }

  // ── Links ────────────────────────────────────────────────────────────────────

  async function handleAddLink(): Promise<void> {
    const label = newLinkLabel.trim()
    const url = newLinkUrl.trim()
    if (!label || !url) return
    const link = await window.electron.ipc.invoke('links:create', {
      projectId: project.id,
      label,
      url
    })
    setLinks((prev) => [...prev, link])
    setNewLinkLabel('')
    setNewLinkUrl('')
    setAddingLink(false)
  }

  async function handleDeleteLink(id: number): Promise<void> {
    await window.electron.ipc.invoke('links:delete', { id })
    setLinks((prev) => prev.filter((l) => l.id !== id))
  }

  function openLink(url: string): void {
    // shell.openExternal is not available in renderer — use IPC or anchor
    // For now open via <a> element as a safe fallback
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.click()
  }

  // ── Sorted todos ─────────────────────────────────────────────────────────────

  const pendingTodos = todos.filter((t) => !t.done)
  const doneTodos = todos.filter((t) => t.done)

  return (
    <div className={styles.root}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.breadcrumb}>
          <button className={styles.backLink} onClick={onBack}>
            Projects
          </button>
          <span className={styles.breadcrumbSep}>/</span>
          {editingName ? (
            <input
              ref={nameRef}
              className={styles.nameInput}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName()
                if (e.key === 'Escape') { setNameDraft(project.name); setEditingName(false) }
              }}
            />
          ) : (
            <button className={styles.projectTitle} onClick={() => setEditingName(true)}>
              {project.name}
            </button>
          )}
        </div>
        <div className={styles.toolbarActions}>
          <button
            className={`${styles.toolbarBtn} ${project.status === 'snoozed' ? styles.toolbarBtnActive : ''}`}
            onClick={() => onUpdate(project.id, { status: project.status === 'snoozed' ? 'active' : 'snoozed' })}
          >
            {project.status === 'snoozed' ? 'Unsnooze' : 'Snooze'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className={styles.content}>
        {/* Next Action Banner */}
        <div className={styles.nextActionBanner}>
          <div className={styles.focusLabel}>
            <svg width="8" height="10" viewBox="0 0 8 10" fill="none" aria-hidden="true">
              <path d="M0 0l8 5-8 5V0z" fill="rgba(255,255,255,0.5)" />
            </svg>
            NEXT ACTION
          </div>
          {editingNextAction ? (
            <textarea
              ref={nextActionRef}
              className={styles.nextActionInput}
              value={nextActionDraft}
              onChange={(e) => setNextActionDraft(e.target.value)}
              onBlur={commitNextAction}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitNextAction() }
                if (e.key === 'Escape') { setNextActionDraft(project.nextAction); setEditingNextAction(false) }
              }}
              rows={2}
              placeholder="What's the next step?"
            />
          ) : (
            <button
              className={styles.nextActionText}
              onClick={() => setEditingNextAction(true)}
            >
              {project.nextAction || <span className={styles.placeholder}>Click to set next action…</span>}
            </button>
          )}
          {!editingNextAction && (
            <div className={styles.nextActionActions}>
              <button onClick={() => setEditingNextAction(true)}>Edit</button>
              {project.nextAction && (
                <button onClick={() => onUpdate(project.id, { nextAction: '' })}>Mark done</button>
              )}
            </div>
          )}
        </div>

        {/* Links Strip */}
        <div className={styles.linksStrip}>
          <span className={styles.linksLabel}>LINKS</span>
          <div className={styles.linksList}>
            {links.map((link) => (
              <div key={link.id} className={styles.linkPillWrapper}>
                <button
                  className={styles.linkPill}
                  onClick={() => openLink(link.url)}
                  title={link.url}
                >
                  {link.label}
                </button>
                <button
                  className={styles.linkDelete}
                  onClick={() => handleDeleteLink(link.id)}
                  aria-label="Remove link"
                >
                  ×
                </button>
              </div>
            ))}
            {addingLink ? (
              <div className={styles.addLinkForm}>
                <input
                  className={styles.addLinkInput}
                  placeholder="Label"
                  value={newLinkLabel}
                  onChange={(e) => setNewLinkLabel(e.target.value)}
                  autoFocus
                />
                <input
                  className={styles.addLinkInput}
                  placeholder="https://…"
                  value={newLinkUrl}
                  onChange={(e) => setNewLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddLink()
                    if (e.key === 'Escape') { setAddingLink(false); setNewLinkLabel(''); setNewLinkUrl('') }
                  }}
                />
                <button className={styles.addLinkConfirm} onClick={handleAddLink}>Add</button>
                <button className={styles.addLinkCancel} onClick={() => { setAddingLink(false); setNewLinkLabel(''); setNewLinkUrl('') }}>Cancel</button>
              </div>
            ) : (
              <button className={styles.addLinkBtn} onClick={() => setAddingLink(true)}>
                + Add
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === 'todos' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('todos')}
          >
            Todos
            {pendingTodos.length > 0 && (
              <span className={styles.tabBadge}>{pendingTodos.length}</span>
            )}
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'notes' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('notes')}
          >
            Notes
          </button>
        </div>

        {/* Tab content */}
        <div className={styles.tabContent}>
          {activeTab === 'todos' && (
            <div className={styles.todoList}>
              {pendingTodos.map((todo) => (
                <TodoRow key={todo.id} todo={todo} onToggle={handleToggleTodo} onDelete={handleDeleteTodo} />
              ))}
              {doneTodos.map((todo) => (
                <TodoRow key={todo.id} todo={todo} onToggle={handleToggleTodo} onDelete={handleDeleteTodo} />
              ))}
              <div className={styles.addTodoRow}>
                <input
                  ref={newTodoRef}
                  className={styles.addTodoInput}
                  placeholder="+ Add task"
                  value={newTodoTitle}
                  onChange={(e) => setNewTodoTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddTodo() }}
                />
              </div>
            </div>
          )}
          {activeTab === 'notes' && (
            <NotesTab project={project} onUpdate={onUpdate} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface TodoRowProps {
  todo: ProjectTodo
  onToggle: (todo: ProjectTodo) => void
  onDelete: (id: number) => void
}

function TodoRow({ todo, onToggle, onDelete }: TodoRowProps): JSX.Element {
  return (
    <div className={`${styles.todoRow} ${todo.done ? styles.todoDone : ''}`}>
      <button
        className={`${styles.checkbox} ${todo.done ? styles.checkboxDone : ''}`}
        onClick={() => onToggle(todo)}
        aria-label={todo.done ? 'Mark undone' : 'Mark done'}
      >
        {todo.done && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
            <path d="M1 3l3 3 5-5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <span className={styles.todoTitle}>{todo.title}</span>
      <button
        className={styles.todoDelete}
        onClick={() => onDelete(todo.id)}
        aria-label="Delete task"
      >
        ×
      </button>
    </div>
  )
}

interface NotesTabProps {
  project: Project
  onUpdate: (id: number, changes: Partial<{ notes: string }>) => Promise<void>
}

function NotesTab({ project, onUpdate }: NotesTabProps): JSX.Element {
  const [draft, setDraft] = useState(project.notes)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setDraft(project.notes)
  }, [project.notes])

  function handleChange(value: string): void {
    setDraft(value)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      onUpdate(project.id, { notes: value })
    }, 600)
  }

  return (
    <textarea
      className={styles.notesArea}
      value={draft}
      onChange={(e) => handleChange(e.target.value)}
      placeholder="Notes, links, context…"
    />
  )
}
