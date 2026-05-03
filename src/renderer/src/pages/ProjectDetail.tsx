import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import styles from './ProjectDetail.module.css'
import { useProjectDetail } from '../hooks/useProjectDetail'
import { useCopilotSessions } from '../hooks/useCopilotSessions'
import { ThreadedNotificationList } from '../components/ThreadedNotificationList'
import { CopilotTab } from '../components/CopilotTab'
import type { NotificationThread, ProjectLink, SnoozeMode } from '@shared/ipc-channels'

type Tab = 'todos' | 'notes' | 'notifications' | 'copilot'

const URL_REGEX = /https?:\/\/[^\s)\]>"']+/g

function renderTodoText(text: string): ReactNode {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  URL_REGEX.lastIndex = 0
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const url = match[0]
    parts.push(
      <button
        key={match.index}
        type="button"
        className={styles.todoLink}
        onClick={(e) => { e.stopPropagation(); window.electron.openExternal(url) }}
        title={url}
      >
        {url}
      </button>
    )
    lastIndex = match.index + url.length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

interface Props {
  projectId: number
  onBack: () => void
  onProjectChanged: () => void
  onDelete: () => void
}

export function ProjectDetail({ projectId, onBack, onProjectChanged, onDelete }: Props) {
  const {
    detail,
    isLoading,
    updateProject,
    snoozeProject,
    createTodo,
    updateTodo,
    deleteTodo,
    createLink,
    deleteLink,
  } = useProjectDetail(projectId, onProjectChanged)

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const stored = localStorage.getItem(`tab:${projectId}`)
    const validTabs: Tab[] = ['todos', 'notes', 'notifications', 'copilot']
    return stored && validTabs.includes(stored as Tab) ? (stored as Tab) : 'todos'
  })

  const [editingAction, setEditingAction] = useState(false)
  const [actionDraft, setActionDraft] = useState('')
  const actionRef = useRef<HTMLTextAreaElement>(null)

  const [newTodoText, setNewTodoText] = useState('')
  const [showLinkForm, setShowLinkForm] = useState(false)
  const [linkLabel, setLinkLabel] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [notesDraft, setNotesDraft] = useState<string | null>(null)

  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false)
  const [snoozeDateDraft, setSnoozeDateDraft] = useState('')
  const snoozeMenuRef = useRef<HTMLDivElement>(null)

  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const [notifications, setNotifications] = useState<NotificationThread[]>([])
  const { sessions: copilotSessions } = useCopilotSessions(projectId)

  // Reset to todos tab if the copilot tab disappears while selected
  useEffect(() => {
    if (activeTab === 'copilot' && copilotSessions.length === 0) {
      setActiveTab('todos')
    }
  }, [activeTab, copilotSessions.length])

  // Close the snooze menu when clicking outside of it or pressing Escape
  useEffect(() => {
    if (!showSnoozeMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (snoozeMenuRef.current && !snoozeMenuRef.current.contains(e.target as Node)) {
        setShowSnoozeMenu(false)
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowSnoozeMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showSnoozeMenu])

  const handleSnooze = async (mode: SnoozeMode, until?: string) => {
    setShowSnoozeMenu(false)
    setSnoozeDateDraft('')
    await snoozeProject(mode, until)
  }

  const loadNotifications = useCallback(async () => {
    try {
      const threads = await window.electron.ipc.invoke('notifications:list', projectId)
      // Filter to unread threads so that marking threads as read removes them persistently
      setNotifications(threads.filter((t) => t.unread))
    } catch (err) {
      console.error('[ProjectDetail] Failed to load notifications:', err)
      // Notifications table may not be ready on first launch, but log unexpected errors
    }
  }, [projectId])

  useEffect(() => {
    void loadNotifications()
    const unsub = window.electron.onNotificationsUpdated(() => { void loadNotifications() })
    return unsub
  }, [loadNotifications])

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
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [editingName])

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

  const handleNameSave = async () => {
    setEditingName(false)
    const name = nameDraft.trim()
    if (name && name !== detail.name) {
      await updateProject({ name })
    }
  }

  const handleDeleteConfirm = async () => {
    setConfirmingDelete(false)
    onDelete()
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
          {editingName ? (
            <input
              ref={nameInputRef}
              className={styles.nameInput}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => void handleNameSave()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleNameSave()
                if (e.key === 'Escape') { setEditingName(false); setNameDraft('') }
              }}
              aria-label="Project name"
            />
          ) : (
            <button
              className={styles.breadcrumbCurrent}
              onClick={() => { setNameDraft(detail.name); setEditingName(true) }}
              title="Click to rename"
            >
              {detail.name}
            </button>
          )}
        </div>
        <div className={styles.toolbarActions}>
          {detail.status === 'snoozed' ? (
            <>
              <span className={styles.snoozedBadge}>
                {detail.snoozeMode === 'date' && detail.snoozeUntil
                  ? `💤 Until ${new Date(detail.snoozeUntil).toLocaleDateString()}`
                  : detail.snoozeMode === 'notification'
                  ? '💤 Until next notification'
                  : '💤 Snoozed'}
              </span>
              <button
                className={styles.actionButton}
                onClick={() => updateProject({ status: 'active' })}
              >
                Unsnooze
              </button>
            </>
          ) : (
            <div className={styles.snoozeWrap} ref={snoozeMenuRef}>
              <button
                className={styles.actionButton}
                onClick={() => setShowSnoozeMenu((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={showSnoozeMenu}
                aria-controls="snooze-menu"
              >
                Snooze ▾
              </button>
              {showSnoozeMenu && (
                <div className={styles.snoozeMenu} id="snooze-menu" role="menu">
                  <button
                    className={styles.snoozeOption}
                    onClick={() => handleSnooze('manual')}
                  >
                    <span className={styles.snoozeOptionIcon}>💤</span>
                    <span>
                      <strong>Indefinitely</strong>
                      <span className={styles.snoozeOptionSub}>Wake manually</span>
                    </span>
                  </button>
                  <button
                    className={styles.snoozeOption}
                    onClick={() => handleSnooze('notification')}
                  >
                    <span className={styles.snoozeOptionIcon}>🔔</span>
                    <span>
                      <strong>Until next notification</strong>
                      <span className={styles.snoozeOptionSub}>Wake when a notification arrives</span>
                    </span>
                  </button>
                  <div className={styles.snoozeDateRow}>
                    <span className={styles.snoozeOptionIcon}>📅</span>
                    <input
                      type="date"
                      className={styles.snoozeDateInput}
                      value={snoozeDateDraft}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setSnoozeDateDraft(e.target.value)}
                    />
                    <button
                      className={styles.snoozeDateBtn}
                      disabled={!snoozeDateDraft}
                      onClick={() => {
                        if (snoozeDateDraft) {
                          // Create a Date at end of the selected day in local time, then convert to ISO string
                          const localDate = new Date(snoozeDateDraft)
                          localDate.setHours(23, 59, 59, 999)
                          handleSnooze('date', localDate.toISOString())
                        }
                      }}
                    >
                      Snooze until date
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {confirmingDelete ? (
            <div className={styles.deleteConfirmInline}>
              <span className={styles.deleteConfirmLabel}>Delete project?</span>
              <button className={styles.actionButton} onClick={() => setConfirmingDelete(false)}>Cancel</button>
              <button className={styles.deleteConfirmBtn} onClick={() => void handleDeleteConfirm()}>Delete</button>
            </div>
          ) : (
            <button
              className={`${styles.actionButton} ${styles.actionButtonDanger}`}
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </button>
          )}
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
          {(['todos', 'notes', 'notifications'] as Tab[]).map((tab) => {
            const unreadCount = tab === 'notifications'
              ? notifications.filter((n) => n.unread).length
              : 0
            return (
              <button
                key={tab}
                className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {unreadCount > 0 && (
                  <span className={styles.tabBadge}>{unreadCount}</span>
                )}
              </button>
            )
          })}
          {copilotSessions.length > 0 && (
            <button
              className={`${styles.tab} ${activeTab === 'copilot' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('copilot')}
            >
              Copilot
            </button>
          )}
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
                  <span className={styles.todoText}>{renderTodoText(todo.text)}</span>
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
                  <span className={`${styles.todoText} ${styles.todoTextDone}`}>{renderTodoText(todo.text)}</span>
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
            <NotificationsTab
              notifications={notifications}
              onMarkRead={async (id) => {
                try {
                  await window.electron.ipc.invoke('notifications:mark-read', id)
                  setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, unread: false } : n))
                  onProjectChanged()
                } catch (err) {
                  console.error('[ProjectDetail] Mark read failed:', err)
                }
              }}
              onMarkReadMany={async (ids) => {
                try {
                  await window.electron.ipc.invoke('notifications:mark-read-many', ids)
                  const idSet = new Set(ids)
                  setNotifications((prev) => prev.map((n) => idSet.has(n.id) ? { ...n, unread: false } : n))
                  onProjectChanged()
                } catch (err) {
                  console.error('[ProjectDetail] Mark read many failed:', err)
                }
              }}
              onUnsubscribe={async (id) => {
                try {
                  await window.electron.ipc.invoke('notifications:unsubscribe', id)
                  await loadNotifications()
                } catch (err) {
                  console.error('[ProjectDetail] Unsubscribe failed:', err)
                }
              }}
            />
          )}

          {activeTab === 'copilot' && (
            <CopilotTab sessions={copilotSessions} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── NotificationsTab ──────────────────────────────────────────────────────────

interface NotificationsTabProps {
  notifications: NotificationThread[]
  onMarkRead: (id: string) => Promise<void>
  onMarkReadMany: (ids: string[]) => Promise<void>
  onUnsubscribe: (id: string) => Promise<void>
}

function NotificationsTab({ notifications, onMarkRead, onMarkReadMany, onUnsubscribe }: NotificationsTabProps) {
  return (
    <ThreadedNotificationList
      threads={notifications}
      onMarkRead={onMarkRead}
      onMarkReadMany={onMarkReadMany}
      onUnsubscribe={onUnsubscribe}
      emptyMessage="No notifications for this project."
      showReadSection={true}
    />
  )
}
