import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Target, Inbox, Settings, Plus } from 'lucide-react'
import type { Project } from '@shared/ipc-channels'
import type { LucideIcon } from 'lucide-react'
import { Icon } from './Icon'
import styles from './CommandPalette.module.css'

interface CommandPaletteProps {
  open: boolean
  projects: Project[]
  onClose: () => void
  onSelectProject: (id: number) => void
  onOpenInbox: () => void
  onOpenSettings: () => void
  onNewProject: () => void
}

interface Entry {
  key: string
  label: string
  hint: string
  icon: LucideIcon
  run: () => void
}

export function CommandPalette({
  open,
  projects,
  onClose,
  onSelectProject,
  onOpenInbox,
  onOpenSettings,
  onNewProject,
}: CommandPaletteProps): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      // Focus after the panel mounts.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const entries = useMemo<Entry[]>(() => {
    const projectEntries: Entry[] = projects.map((p) => ({
      key: `project-${p.id}`,
      label: p.name,
      hint: p.status === 'snoozed' ? 'snoozed' : 'project',
      icon: Target,
      run: () => onSelectProject(p.id),
    }))
    const actionEntries: Entry[] = [
      { key: 'inbox', label: 'Open Inbox', hint: 'go', icon: Inbox, run: onOpenInbox },
      { key: 'settings', label: 'Open Settings', hint: 'go', icon: Settings, run: onOpenSettings },
      { key: 'new', label: 'New project', hint: 'create', icon: Plus, run: onNewProject },
    ]
    return [...projectEntries, ...actionEntries]
  }, [projects, onSelectProject, onOpenInbox, onOpenSettings, onNewProject])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return entries
    return entries.filter((e) => e.label.toLowerCase().includes(q))
  }, [entries, query])

  useEffect(() => {
    setActive((prev) => (prev >= filtered.length ? 0 : prev))
  }, [filtered.length])

  if (!open) return null

  const choose = (entry: Entry | undefined): void => {
    if (!entry) return
    entry.run()
    onClose()
  }

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        className={styles.palette}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.searchRow}>
          <Icon icon={Search} size={16} className={styles.searchIcon} />
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            placeholder="Jump to a project, or run a command…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((i) => Math.max(0, Math.min(i + 1, filtered.length - 1)))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                choose(filtered[active])
              } else if (e.key === 'Escape') {
                onClose()
              }
            }}
          />
        </div>
        <div className={styles.list}>
          {filtered.length === 0 && <div className={styles.noResults}>No matches.</div>}
          {filtered.map((entry, i) => (
            <button type="button"
              key={entry.key}
              className={`${styles.entry} ${i === active ? styles.entryActive : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(entry)}
            >
              <Icon icon={entry.icon} size={15} className={styles.entryIcon} />
              <span className={styles.entryLabel}>{entry.label}</span>
              <span className={styles.entryHint}>{entry.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
