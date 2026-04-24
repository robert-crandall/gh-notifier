import { useState, useEffect } from 'react'
import type { PrefetchProgress } from '@shared/ipc-channels'

/**
 * Tracks thread content prefetch progress emitted by the main process.
 * Returns null when no prefetch is in progress.
 */
export function usePrefetchProgress(): PrefetchProgress | null {
  const [progress, setProgress] = useState<PrefetchProgress | null>(null)

  useEffect(() => {
    const unsub = window.electron.onPrefetchProgress((p) => {
      if (p.completed >= p.total) {
        // Brief delay before clearing so the "done" state is visible momentarily
        setProgress(p)
        setTimeout(() => setProgress(null), 800)
      } else {
        setProgress(p)
      }
    })
    return unsub
  }, [])

  return progress
}
