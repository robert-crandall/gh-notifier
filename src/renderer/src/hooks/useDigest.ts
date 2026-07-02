import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReentryDigest } from '@shared/ipc-channels'

/**
 * Loads the re-entry digest for a project and keeps it fresh as notifications /
 * copilot state change. Dismissing advances the watermark to the digest's asOf.
 */
export function useDigest(projectId: number | null): {
  digest: ReentryDigest | null
  dismiss: () => void
} {
  const [digest, setDigest] = useState<ReentryDigest | null>(null)
  const mountedRef = useRef(true)
  const reqIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    if (projectId === null) {
      setDigest(null)
      return
    }
    const reqId = ++reqIdRef.current
    try {
      const result = await window.electron.ipc.invoke('digest:get', projectId)
      // Only the most recent request wins, and never after unmount.
      if (mountedRef.current && reqId === reqIdRef.current) setDigest(result)
    } catch (err) {
      console.error('[useDigest] Failed to load digest:', err)
      if (mountedRef.current && reqId === reqIdRef.current) setDigest(null)
    }
  }, [projectId])

  useEffect(() => {
    void load()
    const unsubNotifications = window.electron.onNotificationsUpdated(() => { void load() })
    const unsubCopilot = window.electron.onCopilotUpdated(() => { void load() })
    return () => { unsubNotifications(); unsubCopilot() }
  }, [load])

  const dismiss = useCallback((): void => {
    if (projectId === null || digest === null) return
    setDigest((prev) => (prev ? { ...prev, items: [] } : null))
    void window.electron.ipc.invoke('digest:dismiss', projectId, digest.asOf).catch((err: unknown) => {
      console.error('[useDigest] dismiss failed:', err)
    })
  }, [projectId, digest])

  return { digest, dismiss }
}
