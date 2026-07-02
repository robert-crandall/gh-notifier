import { useEffect, useRef, useState } from 'react'
import { Pencil, Check } from 'lucide-react'
import { Icon } from './Icon'
import styles from './NextAction.module.css'

interface NextActionProps {
  value: string
  onSave: (text: string) => void
  onDone: () => void
}

export function NextAction({ value, onSave, onDone }: NextActionProps): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = (): void => {
    setEditing(false)
    const next = draft.trim()
    if (next !== value) onSave(next)
  }

  const hasValue = value.trim().length > 0

  return (
    <div className={styles.wrap}>
      <div className={styles.label}>Next action</div>

      {editing ? (
        <textarea
          ref={inputRef}
          className={styles.input}
          value={draft}
          rows={1}
          placeholder="What's the one next thing?"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              setDraft(value)
              setEditing(false)
            }
          }}
        />
      ) : (
        <div className={styles.line}>
          <button
            className={`${styles.text} ${hasValue ? '' : styles.placeholder}`}
            onClick={() => setEditing(true)}
          >
            {hasValue ? value : 'Set your next action…'}
          </button>
          <button className={styles.editIcon} onClick={() => setEditing(true)} aria-label="Edit next action">
            <Icon icon={Pencil} size={14} />
          </button>
        </div>
      )}

      <div className={styles.buttons}>
        <button className={styles.secondary} onClick={() => setEditing(true)}>
          <Icon icon={Pencil} size={14} />
          Edit
        </button>
        <button className={styles.primary} onClick={onDone} disabled={!hasValue}>
          <Icon icon={Check} size={14} />
          Done
        </button>
      </div>
    </div>
  )
}
