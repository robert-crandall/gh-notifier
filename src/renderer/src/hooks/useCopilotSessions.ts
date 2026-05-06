import { useState, useEffect, useCallback } from 'react'
import type { CopilotSession } from '@shared/ipc-channels'

interface UseCopilotSessionsResult {
  sessions: CopilotSession[]
  isLoading: boolean
  refresh: () => Promise<void>
}

export function useCopilotSessions(projectId: number): UseCopilotSessionsResult {
  const [sessions, setSessions] = useState<CopilotSession[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = await window.electron.ipc.invoke('copilot:sessions-for-project', projectId)
      setSessions(result)
    } catch (err) {
      console.error('[useCopilotSessions] Failed to load sessions:', err)
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setIsLoading(true)
    void refresh()
    const unsub = window.electron.onCopilotUpdated(() => { void refresh() })
    return unsub
  }, [refresh])

  return { sessions, isLoading, refresh }
}
