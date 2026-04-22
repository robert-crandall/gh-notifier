import { useState } from 'react'
import styles from './Dashboard.module.css'
import type { Project } from '@shared/ipc-channels'

interface Props {
  projects: Project[]
  onSelectProject: (id: number) => void
  onCreateProject: (name: string) => Promise<Project>
}

export function Dashboard({ projects, onSelectProject, onCreateProject }: Props) {
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [snoozedExpanded, setSnoozedExpanded] = useState(false)

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
            return (
              <li key={p.id}>
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
              <ul className={styles.snoozedList}>
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
