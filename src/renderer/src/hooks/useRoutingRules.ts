import { useState, useEffect } from 'react'
import type { RoutingRule, CreateRoutingRulePayload, Project } from '@shared/ipc-channels'

export function useRoutingRules() {
  const [rules, setRules] = useState<RoutingRule[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [loadedRules, loadedProjects] = await Promise.all([
          window.electron.ipc.invoke('routing-rules:list'),
          window.electron.ipc.invoke('projects:list'),
        ])
        setRules(loadedRules)
        setProjects(loadedProjects)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load routing rules')
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  const addRule = async (payload: CreateRoutingRulePayload): Promise<void> => {
    const rule = await window.electron.ipc.invoke('routing-rules:create', payload)
    setRules((prev) => [...prev, rule])
  }

  const removeRule = async (id: number): Promise<void> => {
    await window.electron.ipc.invoke('routing-rules:delete', id)
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  const applyToInbox = async (): Promise<{ matched: number }> => {
    return window.electron.ipc.invoke('routing-rules:apply-to-inbox')
  }

  return { rules, projects, isLoading, error, addRule, removeRule, applyToInbox }
}
