import { useState, useRef, useEffect } from 'react'
import styles from './Dashboard.module.css'
import type { Project, ProjectPatch } from '@shared/ipc-channels'

interface Props {
  projects: Project[]
  onSelectProject: (id: number) => void
  onCreateProject: (name: string) => Promise<Project>
  onUpdateProject: (id: number, patch: ProjectPatch) => Promise<Project>
  onDeleteProject: (id: number) => Promise<void>
}

export function Dashboard({ projects, onSelectProject, onCreateProject, onUpdateProject, onDeleteProject }: Props) {
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [snoozedExpanded, setSnoozedExpanded] = useState(false)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId !== null && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  const active = projects.filter((p) => p.status === 'active')
  const snoozed = projects.filter((p) => p.status === 'snoozed')

  // The "focus" project: first active project with a next action, or just the first active
  const focusProject =
    active.find((p) => p.nextAction.trim().length > 0) ?? active[0] ?? null

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const project = await onCreateProject(name)
      setNewName('')
      setShowNewForm(false)
      onSelectProject(project.id)
    } finally {
      setCreating(false)
    }
  }

  const handleEditStart = (e: React.MouseEvent, p: Project) => {
    e.stopPropagation()
    setConfirmDeleteId(null)
    setEditingId(p.id)
    setEditName(p.name)
  }

  const handleEditSave = async (id: number) => {
    const name = editName.trim()
    setEditingId(null)
    if (name) {
      await onUpdateProject(id, { name })
    }
  }

  const handleEditCancel = () => {
    setEditingId(null)
    setEditName('')
  }

  const handleDeleteRequest = (e: React.MouseEvent, id: number) => {
    e.stopPropagation()
    setEditingId(null)
    setConfirmDeleteId(id)
  }

  const handleDeleteConfirm = async (id: number) => {
    setConfirmDeleteId(null)
    await onDeleteProject(id)
  }

  return (
    <div className={styles.main}>
      {/* Toolbar */}
      <header className={styles.toolbar}>
        <span className={styles.toolbarTitle}>Projects</span>
        <button className={styles.newButton} onClick={() => setShowNewForm(true)}>
          + New project
        </button>
      </header>

      {/* New project inline form */}
      {showNewForm && (
        <div className={styles.newForm}>
          <input
            className={styles.newInput}
            autoFocus
            placeholder="Project name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
              if (e.key === 'Escape') { setShowNewForm(false); setNewName('') }
            }}
          />
          <div className={styles.newFormActions}>
            <button className={styles.cancelButton} onClick={() => { setShowNewForm(false); setNewName('') }}>
              Cancel
            </button>
            <button
              className={styles.createButton}
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
            >
              Create
            </button>
          </div>
        </div>
      )}

      <div className={styles.content}>
        {/* Focus banner — top active project with a next action */}
        {focusProject?.nextAction && (
          <button
            className={styles.focusBanner}
            onClick={() => onSelectProject(focusProject.id)}
          >
            <div className={styles.focusLabel}>
              {/* Play arrow SVG */}
              <svg width="8" height="9" viewBox="0 0 8 9" fill="none" aria-hidden="true">
                <path d="M1 1l6 3.5L1 8V1z" fill="rgba(255,255,255,0.5)" />
              </svg>
              <span>FOCUS NOW · {focusProject.name.toUpperCase()}</span>
            </div>
            <p className={styles.focusAction}>{focusProject.nextAction}</p>
          </button>
        )}

        {/* Project rows */}
        {active.length === 0 && !showNewForm && (
          <div className={styles.emptyState}>
            <p>No projects yet.</p>
            <button className={styles.emptyCreateButton} onClick={() => setShowNewForm(true)}>
              Create your first project
            </button>
          </div>
        )}

        <ul className={styles.projectList}>
          {active.map((p) => {
            const isFocused = p.id === focusProject?.id
            if (editingId === p.id) {
              return (
                <li key={p.id}>
                  <div className={styles.renameForm}>
                    <input
                      ref={editInputRef}
                      className={styles.renameInput}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleEditSave(p.id)
                        if (e.key === 'Escape') handleEditCancel()
                      }}
                      onBlur={() => void handleEditSave(p.id)}
                    />
                    <div className={styles.renameActions}>
                      <button className={styles.cancelButton} onMouseDown={(e) => { e.preventDefault(); handleEditCancel() }}>Cancel</button>
                      <button className={styles.createButton} onMouseDown={(e) => { e.preventDefault(); void handleEditSave(p.id) }}>Save</button>
                    </div>
                  </div>
                </li>
              )
            }
            if (confirmDeleteId === p.id) {
              return (
                <li key={p.id}>
                  <div className={styles.deleteConfirm}>
                    <span className={styles.deleteConfirmText}>Delete &ldquo;{p.name}&rdquo;?</span>
                    <div className={styles.deleteConfirmActions}>
                      <button className={styles.cancelButton} onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                      <button className={styles.deleteButton} onClick={() => void handleDeleteConfirm(p.id)}>Delete</button>
                    </div>
                  </div>
                </li>
              )
            }
            return (
              <li key={p.id} className={styles.projectItem}>
                <button
                  className={`${styles.projectRow} ${isFocused ? styles.focused : ''}`}
                  onClick={() => onSelectProject(p.id)}
                >
                  <div className={styles.projectInfo}>
                    <span className={styles.projectName}>{p.name}</span>
                    {p.nextAction && (
                      <span className={styles.nextAction}>{p.nextAction}</span>
                    )}
                  </div>
                  {/* Chevron */}
                  <svg className={styles.chevron} width="6" height="10" viewBox="0 0 6 10" fill="none" aria-hidden="true">
                    <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div className={styles.rowActions}>
                  <button
                    className={styles.rowActionBtn}
                    onClick={(e) => handleEditStart(e, p)}
                    aria-label={`Rename ${p.name}`}
                    title="Rename"
                  >
                    {/* Pencil icon */}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path d="M8.5 1.5a1.414 1.414 0 0 1 2 2L4 10H2v-2L8.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  <button
                    className={`${styles.rowActionBtn} ${styles.rowActionDelete}`}
                    onClick={(e) => handleDeleteRequest(e, p.id)}
                    aria-label={`Delete ${p.name}`}
                    title="Delete"
                  >
                    {/* Trash icon */}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path d="M2 3h8M5 3V2h2v1M4 3v6.5a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5V3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </li>
            )
          })}
        </ul>

        {/* Snoozed section */}
        {snoozed.length > 0 && (
          <div className={styles.snoozedSection}>
            <button
              className={styles.snoozedToggle}
              onClick={() => setSnoozedExpanded((v) => !v)}
              aria-expanded={snoozedExpanded}
              aria-controls="snoozed-projects-list"
            >
              <svg
                className={`${styles.snoozedChevron} ${snoozedExpanded ? styles.snoozedChevronOpen : ''}`}
                width="10"
                height="6"
                viewBox="0 0 10 6"
                fill="none"
                aria-hidden="true"
              >
                <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>💤 {snoozed.length} snoozed project{snoozed.length !== 1 ? 's' : ''}</span>
            </button>
            {snoozedExpanded && (
              <ul className={styles.snoozedList} id="snoozed-projects-list">
                {snoozed.map((p) => (
                  <li key={p.id}>
                    <button
                      className={styles.snoozedRow}
                      onClick={() => onSelectProject(p.id)}
                    >
                      <div className={styles.projectInfo}>
                        <span className={styles.snoozedName}>{p.name}</span>
                        <span className={styles.snoozedMeta}>
                          {p.snoozeMode === 'date' && p.snoozeUntil
                            ? `Until ${new Date(p.snoozeUntil).toLocaleDateString()}`
                            : p.snoozeMode === 'notification'
                            ? 'Until next notification'
                            : 'Manual snooze'}
                        </span>
                      </div>
                      <svg className={styles.chevron} width="6" height="10" viewBox="0 0 6 10" fill="none" aria-hidden="true">
                        <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
