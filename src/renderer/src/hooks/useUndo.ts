import { useCallback, useRef, useState } from 'react'

export interface UndoState {
  id: number
  message: string
  actionLabel: string
  onUndo: () => void
}

const UNDO_TIMEOUT_MS = 6000

/**
 * A single-slot undo toast. `showUndo` displays a message with an action that
 * auto-dismisses after a timeout. Used for soft-deletes and reversible actions.
 */
export function useUndo(): {
  undo: UndoState | null
  showUndo: (message: string, onUndo: () => void, actionLabel?: string) => void
  clearUndo: () => void
} {
  const [undo, setUndo] = useState<UndoState | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idRef = useRef(0)

  const clearUndo = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setUndo(null)
  }, [])

  const showUndo = useCallback(
    (message: string, onUndo: () => void, actionLabel = 'Undo'): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      const id = ++idRef.current
      setUndo({ id, message, actionLabel, onUndo })
      timerRef.current = setTimeout(() => {
        setUndo((current) => (current?.id === id ? null : current))
        timerRef.current = null
      }, UNDO_TIMEOUT_MS)
    },
    []
  )

  return { undo, showUndo, clearUndo }
}
