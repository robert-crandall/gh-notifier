import { useState, useRef, useEffect, useCallback } from 'react'
import styles from './ProjectDetail.module.css'
import { useProjectDetail } from '../hooks/useProjectDetail'
import type { NotificationThread, NotificationType, ProjectLink, SnoozeMode } from '@shared/ipc-channels'
import { buildThreadUrl } from '@shared/thread-url'

type Tab = 'todos' | 'notes' | 'notifications'

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
    const validTabs: Tab[] = ['todos', 'notes', 'notifications']
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
      setNotifications(threads)
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

  // Mark all notifications as read when the notifications tab is opened
  useEffect(() => {
    if (activeTab !== 'notifications') return
    
    const unread = notifications.filter((n) => n.unread)
    if (unread.length === 0) return
    
    setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })))
    
    void (async () => {
      await Promise.allSettled(
        unread.map((n) => window.electron.ipc.invoke('notifications:mark-read', n.id))
      )
      onProjectChanged()
    })()
  }, [activeTab, notifications, onProjectChanged])

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
        </div>
      </div>
    </div>
  )
}

// ── NotificationsTab ──────────────────────────────────────────────────────────

interface NotificationsTabProps {
  notifications: NotificationThread[]
  onMarkRead: (id: string) => Promise<void>
  onUnsubscribe: (id: string) => Promise<void>
}

function NotificationsTab({ notifications, onMarkRead, onUnsubscribe }: NotificationsTabProps) {
  if (notifications.length === 0) {
    return (
      <div className={styles.notificationsEmpty}>
        <p>No notifications for this project.</p>
      </div>
    )
  }

  // Group by repo
  const groups = new Map<string, NotificationThread[]>()
  for (const n of notifications) {
    const key = `${n.repoOwner}/${n.repoName}`
    const existing = groups.get(key) ?? []
    existing.push(n)
    groups.set(key, existing)
  }

  return (
    <div className={styles.notificationsList}>
      {Array.from(groups.entries()).map(([repoKey, threads]) => (
        <div key={repoKey} className={styles.notificationGroup}>
          <div className={styles.notificationGroupHeader}>
            <span>{repoKey}</span>
            <div className={styles.notificationGroupDivider} />
          </div>
          {threads.map((n) => (
            <div key={n.id} className={styles.notificationRow}>
              <div
                className={styles.notificationDot}
                data-unread={n.unread}
              />
              <div className={styles.notificationBody}>
                <div className={styles.notificationTitle}>
                  <button
                    className={`${styles.notificationName} ${styles.notificationNameLink}`}
                    data-unread={n.unread}
                    onClick={() => window.electron.openExternal(buildThreadUrl(n))}
                    title="Open in browser"
                  >
                    {n.title}
                  </button>
                  <NotificationTypeChip type={n.type} />
                  {n.subjectState && n.subjectState !== 'open' && (
                    <NotificationStateChip state={n.subjectState} />
                  )}
                </div>
                <div className={styles.notificationMeta}>
                  <span className={styles.notificationRepo}>
                    {n.repoOwner}/{n.repoName}
                  </span>
                </div>
              </div>
              <div className={styles.notificationIconGroup}>
                    <button
                      className={styles.notificationIconBtn}
                      title="Open in GitHub"
                      aria-label="Open in GitHub"
                      onClick={() => window.electron.openExternal(buildThreadUrl(n))}
                    >
                      <ExternalLinkIcon />
                    </button>
                    <button
                      className={styles.notificationIconBtn}
                      title="Mark as read"
                      aria-label="Mark as read"
                      disabled={!n.unread}
                      onClick={() => void onMarkRead(n.id)}
                    >
                      <MarkReadIcon />
                    </button>
                    <button
                      className={styles.notificationIconBtn}
                      title="Unsubscribe"
                      aria-label="Unsubscribe"
                      onClick={() => void onUnsubscribe(n.id)}
                    >
                      <UnsubscribeIcon />
                    </button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function ExternalLinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M5 2H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M8 1.5H11.5V5M11.5 1.5 5.5 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function MarkReadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M2 6.5l3.5 3.5 5.5-5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function UnsubscribeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M6.5 1v.5M5 11a1.5 1.5 0 0 0 3 0M3 9.5h7L9 8V5.5a2.5 2.5 0 0 0-5 0V8L3 9.5Z" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="2" y1="2" x2="11" y2="11" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  )
}

function NotificationTypeChip({ type }: { type: NotificationType }) {
  const chipClass =
    type === 'PullRequest' ? styles.typeChipPR
    : type === 'Issue' ? styles.typeChipIssue
    : type === 'Release' ? styles.typeChipRelease
    : styles.typeChipOther

  const label =
    type === 'PullRequest' ? 'PR'
    : type === 'CheckSuite' ? 'CI'
    : type

  return <span className={`${styles.typeChip} ${chipClass}`}>{label}</span>
}

function NotificationStateChip({ state }: { state: string }) {
  const stateClass =
    state === 'merged' ? styles.stateChipMerged
    : state === 'closed' ? styles.stateChipClosed
    : styles.stateChipOpen
  return <span className={`${styles.stateChip} ${stateClass}`}>{state}</span>
}
