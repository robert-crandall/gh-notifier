import { useState, useEffect, useRef } from 'react'
import type { PrefetchProgress } from '@shared/ipc-channels'

/**
 * Tracks thread content prefetch progress emitted by the main process.
 * Returns null when no prefetch is in progress.
 */
export function usePrefetchProgress(): PrefetchProgress | null {
  const [progress, setProgress] = useState<PrefetchProgress | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const unsub = window.electron.onPrefetchProgress((p) => {
      // Clear any existing timeout to prevent stale clears
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }

      if (p.completed >= p.total) {
        // Brief delay before clearing so the "done" state is visible momentarily
        setProgress(p)
        timeoutRef.current = setTimeout(() => {
          setProgress(null)
          timeoutRef.current = null
        }, 800)
      } else {
        setProgress(p)
      }
    })

    return () => {
      unsub()
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return progress
}
