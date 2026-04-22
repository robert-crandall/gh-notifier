import { useState, useRef, useEffect } from 'react'
import styles from './NewProjectModal.module.css'

interface NewProjectModalProps {
  onCancel: () => void
  onCreate: (name: string) => void
}

export function NewProjectModal({ onCancel, onCreate }: NewProjectModalProps): JSX.Element {
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed) {
      onCreate(trimmed)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      onCancel()
    }
  }

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>New Project</h2>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className={styles.actions}>
            <button type="button" className={styles.btnCancel} onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className={styles.btnCreate} disabled={!name.trim()}>
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
