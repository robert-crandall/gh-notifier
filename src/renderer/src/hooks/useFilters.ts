import { useState, useEffect, useCallback } from 'react'
import type { NotificationFilter, FilterDimension, FilterScope } from '@shared/ipc-channels'

export function useFilters() {
  const [filters, setFilters] = useState<NotificationFilter[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const result = await window.electron.ipc.invoke('filters:list')
      setFilters(result)
    } catch (err) {
      console.error('[useFilters] Failed to load filters:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const addFilter = useCallback(
    async (
      dimension: FilterDimension,
      value: string,
      scope: FilterScope = 'global',
      scopeOwner?: string,
      scopeRepo?: string,
    ) => {
      const created = await window.electron.ipc.invoke(
        'filters:create',
        dimension,
        value,
        scope,
        scopeOwner,
        scopeRepo,
      )
      setFilters((prev) => [...prev, created])
    },
    [],
  )

  const removeFilter = useCallback(async (id: number) => {
    try {
      await window.electron.ipc.invoke('filters:delete', id)
      setFilters((prev) => prev.filter((f) => f.id !== id))
    } catch (err) {
      console.error('[useFilters] Failed to remove filter:', err)
      throw err
    }
  }, [])

  return { filters, isLoading, addFilter, removeFilter }
}
