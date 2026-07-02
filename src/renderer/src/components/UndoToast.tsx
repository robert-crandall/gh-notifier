import { Undo2 } from 'lucide-react'
import type { UndoState } from '../hooks/useUndo'
import { Icon } from './Icon'
import styles from './UndoToast.module.css'

interface UndoToastProps {
  undo: UndoState | null
  onAction: () => void
}

export function UndoToast({ undo, onAction }: UndoToastProps): JSX.Element | null {
  if (undo === null) return null
  return (
    <div className={styles.toast} role="status">
      <span className={styles.message}>{undo.message}</span>
      <button type="button" className={styles.action} onClick={onAction}>
        <Icon icon={Undo2} size={14} />
        {undo.actionLabel}
      </button>
    </div>
  )
}
