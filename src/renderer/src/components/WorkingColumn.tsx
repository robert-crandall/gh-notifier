import { useEffect, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  CheckSquare,
  FileText,
  Database,
  Bell,
  Plus,
  Check,
  GitPullRequest,
  CircleDot,
  Tag,
  MessageSquare,
  GitCommit,
  CircleAlert,
  ExternalLink,
  Trash2,
} from 'lucide-react'
import type { NotificationThread, NotificationType, ProjectDetail, ProjectLink, ProjectTodo } from '@shared/ipc-channels'
import type { LucideIcon } from 'lucide-react'
import { Icon } from './Icon'
import { fire, openExternal } from '../ipc'
import styles from './WorkingColumn.module.css'

type TabId = 'todos' | 'notes' | 'resources' | 'notifications'

interface WorkingColumnProps {
  detail: ProjectDetail
  onCreateTodo: (text: string) => void
  onToggleTodo: (todo: ProjectTodo) => void
  onDeleteTodo: (todo: ProjectTodo) => void
  onSaveNotes: (notes: string) => void
  onCreateLink: (label: string, url: string) => void
  onDeleteLink: (link: ProjectLink) => void
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return ''
  }
}

// ── Todos ─────────────────────────────────────────────────────────────────────

function TodosPanel({
  detail,
  onCreateTodo,
  onToggleTodo,
  onDeleteTodo,
}: Pick<WorkingColumnProps, 'detail' | 'onCreateTodo' | 'onToggleTodo' | 'onDeleteTodo'>): JSX.Element {
  const [text, setText] = useState('')
  const active = detail.todos.filter((t) => !t.done)
  const done = detail.todos.filter((t) => t.done)

  const submit = (): void => {
    const trimmed = text.trim()
    if (trimmed.length === 0) return
    onCreateTodo(trimmed)
    setText('')
  }

  return (
    <div className={styles.todos}>
      <div className={styles.addRow}>
        <Icon icon={Plus} size={15} className={styles.muted} />
        <input
          className={styles.addInput}
          value={text}
          placeholder="Add a todo…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
      {active.map((t) => (
        <div key={t.id} className={styles.todoRow}>
          <button type="button" className={styles.checkbox} onClick={() => onToggleTodo(t)} aria-label="Mark done" />
          <span className={styles.todoText}>{t.text}</span>
          <button type="button" className={styles.rowAction} onClick={() => onDeleteTodo(t)} aria-label="Delete todo">
            <Icon icon={Trash2} size={13} />
          </button>
        </div>
      ))}
      {done.length > 0 && <div className={styles.divider} />}
      {done.map((t) => (
        <div key={t.id} className={`${styles.todoRow} ${styles.todoDone}`}>
          <button type="button" className={`${styles.checkbox} ${styles.checkboxDone}`} onClick={() => onToggleTodo(t)} aria-label="Mark not done">
            <Icon icon={Check} size={11} strokeWidth={3} />
          </button>
          <span className={`${styles.todoText} ${styles.struck}`}>{t.text}</span>
          <button type="button" className={styles.rowAction} onClick={() => onDeleteTodo(t)} aria-label="Delete todo">
            <Icon icon={Trash2} size={13} />
          </button>
        </div>
      ))}
      {detail.todos.length === 0 && <div className={styles.empty}>No todos yet. Add the first one above.</div>}
    </div>
  )
}

// ── Notes ─────────────────────────────────────────────────────────────────────

function NotesPanel({ detail, onSaveNotes }: Pick<WorkingColumnProps, 'detail' | 'onSaveNotes'>): JSX.Element {
  const [draft, setDraft] = useState(detail.notes)
  useEffect(() => setDraft(detail.notes), [detail.notes, detail.id])

  return (
    <textarea
      className={styles.notes}
      value={draft}
      placeholder="Freeform scratch — dump whatever's in your head…"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== detail.notes && onSaveNotes(draft)}
    />
  )
}

// ── Resources (existing project links) ────────────────────────────────────────

function ResourcesPanel({
  detail,
  onCreateLink,
  onDeleteLink,
}: Pick<WorkingColumnProps, 'detail' | 'onCreateLink' | 'onDeleteLink'>): JSX.Element {
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')

  const submit = (): void => {
    const l = label.trim()
    const u = url.trim()
    if (l.length === 0 || u.length === 0) return
    onCreateLink(l, u)
    setLabel('')
    setUrl('')
  }

  return (
    <div className={styles.resources}>
      <div className={styles.linkAdd}>
        <input className={styles.linkInput} value={label} placeholder="Label" onChange={(e) => setLabel(e.target.value)} />
        <input
          className={styles.linkInput}
          value={url}
          placeholder="https://…"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button type="button" className={styles.linkAddBtn} onClick={submit} aria-label="Add resource">
          <Icon icon={Plus} size={15} />
        </button>
      </div>
      {detail.links.map((link) => (
        <div key={link.id} className={styles.resourceRow}>
          <button type="button" className={styles.resourceLink} onClick={() => openExternal(link.url)}>
            <Icon icon={ExternalLink} size={15} className={styles.muted} />
            <span className={styles.resourceLabel}>{link.label}</span>
          </button>
          <button type="button" className={styles.rowAction} onClick={() => onDeleteLink(link)} aria-label="Delete resource">
            <Icon icon={Trash2} size={13} />
          </button>
        </div>
      ))}
      {detail.links.length === 0 && (
        <div className={styles.empty}>No resources yet. Paste a dashboard, query, or doc link above.</div>
      )}
    </div>
  )
}

// ── Notifications ─────────────────────────────────────────────────────────────

const NOTIF_ICON: Record<NotificationType, LucideIcon> = {
  PullRequest: GitPullRequest,
  Issue: CircleDot,
  Release: Tag,
  Discussion: MessageSquare,
  Commit: GitCommit,
  CheckSuite: CircleAlert,
}

function NotificationsPanel({ projectId }: { projectId: number }): JSX.Element {
  const [threads, setThreads] = useState<NotificationThread[]>([])

  useEffect(() => {
    let active = true
    const load = async (): Promise<void> => {
      try {
        const list = await window.electron.ipc.invoke('notifications:list', projectId)
        if (active) setThreads(list)
      } catch (err) {
        console.error('[Notifications] load failed:', err)
      }
    }
    void load()
    const unsub = window.electron.onNotificationsUpdated(() => { void load() })
    return () => {
      active = false
      unsub()
    }
  }, [projectId])

  const open = (t: NotificationThread): void => {
    if (t.htmlUrl) openExternal(t.htmlUrl)
    fire(window.electron.ipc.invoke('notifications:mark-read', t.id), 'notifications:mark-read')
  }

  if (threads.length === 0) {
    return <div className={styles.empty}>Nothing unread here right now.</div>
  }

  return (
    <div className={styles.notifs}>
      {threads.map((t) => (
        <button type="button" key={t.id} className={styles.notifRow} onClick={() => open(t)}>
          <Icon icon={NOTIF_ICON[t.type] ?? Bell} size={16} className={styles.notifIcon} />
          <div className={styles.notifBody}>
            <div className={styles.notifTitle}>{t.title}</div>
            <div className={styles.notifMeta}>
              {t.repoOwner}/{t.repoName} · {relativeTime(t.updatedAt)}
            </div>
          </div>
          {t.unread && <span className={styles.unreadDot} aria-hidden />}
        </button>
      ))}
    </div>
  )
}

// ── Container ─────────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'todos', label: 'Todos', icon: CheckSquare },
  { id: 'notes', label: 'Notes', icon: FileText },
  { id: 'resources', label: 'Resources', icon: Database },
  { id: 'notifications', label: 'Notifications', icon: Bell },
]

export function WorkingColumn(props: WorkingColumnProps): JSX.Element {
  const [tab, setTab] = useState<TabId>('todos')
  const notifCountRef = useRef(props.detail.unreadCount)
  notifCountRef.current = props.detail.unreadCount

  return (
    <div className={styles.column}>
      <div className={styles.tabs}>
        {TABS.map((t) => (
          <button type="button"
            key={t.id}
            className={styles.tab}
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            <Icon icon={t.icon} size={14} />
            {t.label}
            {t.id === 'notifications' && props.detail.unreadCount > 0 && (
              <span className={styles.tabBadge}>{props.detail.unreadCount}</span>
            )}
          </button>
        ))}
      </div>
      <div className={styles.panel}>
        {tab === 'todos' && (
          <TodosPanel
            detail={props.detail}
            onCreateTodo={props.onCreateTodo}
            onToggleTodo={props.onToggleTodo}
            onDeleteTodo={props.onDeleteTodo}
          />
        )}
        {tab === 'notes' && <NotesPanel detail={props.detail} onSaveNotes={props.onSaveNotes} />}
        {tab === 'resources' && (
          <ResourcesPanel detail={props.detail} onCreateLink={props.onCreateLink} onDeleteLink={props.onDeleteLink} />
        )}
        {tab === 'notifications' && <NotificationsPanel projectId={props.detail.id} />}
      </div>
    </div>
  )
}
