import { useCallback, useEffect, useState } from 'react'

const FOCUS_KEY = 'focus-last-project'

/**
 * Tracks the currently-focused project id (persisted across launches) and marks
 * the drift anchor (last_focused_at) whenever focus lands on a project.
 */
export function useFocus(): {
  focusedId: number | null
  setFocusedId: (id: number | null) => void
} {
  const [focusedId, setFocusedIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem(FOCUS_KEY)
    if (stored === null) return null
    const parsed = Number.parseInt(stored, 10)
    return Number.isFinite(parsed) ? parsed : null
  })

  const setFocusedId = useCallback((id: number | null): void => {
    setFocusedIdState(id)
    if (id === null) localStorage.removeItem(FOCUS_KEY)
    else localStorage.setItem(FOCUS_KEY, String(id))
  }, [])

  // On focus arrival, advance the drift anchor so the project stops drifting.
  useEffect(() => {
    if (focusedId === null) return
    void window.electron.ipc.invoke('projects:mark-focused', focusedId).catch((err: unknown) => {
      console.error('[useFocus] mark-focused failed:', err)
    })
  }, [focusedId])

  return { focusedId, setFocusedId }
}
