import { useState, useEffect, useCallback } from 'react'
import type {
  ProjectDetail,
  ProjectPatch,
  ProjectTodoPatch,
  ProjectLinkPatch,
  SnoozeMode,
} from '@shared/ipc-channels'

interface UseProjectDetailResult {
  detail: ProjectDetail | null
  isLoading: boolean
  updateProject: (patch: ProjectPatch) => Promise<void>
  snoozeProject: (mode: SnoozeMode, until?: string) => Promise<void>
  createTodo: (text: string) => Promise<void>
  updateTodo: (id: number, patch: ProjectTodoPatch) => Promise<void>
  deleteTodo: (id: number) => Promise<void>
  createLink: (label: string, url: string) => Promise<void>
  updateLink: (id: number, patch: ProjectLinkPatch) => Promise<void>
  deleteLink: (id: number) => Promise<void>
}

export function useProjectDetail(
  projectId: number,
  onProjectChanged?: () => void
): UseProjectDetailResult {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isActive = true

    const loadProjectDetail = async (): Promise<void> => {
      setIsLoading(true)

      try {
        const d = await window.electron.ipc.invoke('projects:get', projectId)

        if (!isActive) {
          return
        }

        setDetail(d)
      } catch (error: unknown) {
        if (!isActive) {
          return
        }

        console.error('Failed to load project detail', error)
      } finally {
        if (isActive) {
          setIsLoading(false)
        }
      }
    }

    void loadProjectDetail()

    return () => {
      isActive = false
    }
  }, [projectId])

  const updateProject = useCallback(
    async (patch: ProjectPatch): Promise<void> => {
      const updated = await window.electron.ipc.invoke('projects:update', projectId, patch)
      setDetail((prev) => (prev ? { ...prev, ...updated } : null))
      onProjectChanged?.()
    },
    [projectId, onProjectChanged]
  )

  const snoozeProject = useCallback(
    async (mode: SnoozeMode, until?: string): Promise<void> => {
      const updated = await window.electron.ipc.invoke('projects:snooze', projectId, mode, until)
      setDetail((prev) => (prev ? { ...prev, ...updated } : null))
      onProjectChanged?.()
    },
    [projectId, onProjectChanged]
  )

  const createTodo = useCallback(
    async (text: string): Promise<void> => {
      const todo = await window.electron.ipc.invoke('todos:create', projectId, text)
      setDetail((prev) => (prev ? { ...prev, todos: [...prev.todos, todo] } : null))
    },
    [projectId]
  )

  const updateTodo = useCallback(async (id: number, patch: ProjectTodoPatch): Promise<void> => {
    const updated = await window.electron.ipc.invoke('todos:update', id, patch)
    setDetail((prev) =>
      prev ? { ...prev, todos: prev.todos.map((t) => (t.id === id ? updated : t)) } : null
    )
    onProjectChanged?.()
  }, [onProjectChanged])

  const deleteTodo = useCallback(async (id: number): Promise<void> => {
    await window.electron.ipc.invoke('todos:delete', id)
    setDetail((prev) =>
      prev ? { ...prev, todos: prev.todos.filter((t) => t.id !== id) } : null
    )
  }, [])

  const createLink = useCallback(
    async (label: string, url: string): Promise<void> => {
      const link = await window.electron.ipc.invoke('links:create', projectId, label, url)
      setDetail((prev) => (prev ? { ...prev, links: [...prev.links, link] } : null))
    },
    [projectId]
  )

  const updateLink = useCallback(async (id: number, patch: ProjectLinkPatch): Promise<void> => {
    const updated = await window.electron.ipc.invoke('links:update', id, patch)
    setDetail((prev) =>
      prev ? { ...prev, links: prev.links.map((l) => (l.id === id ? updated : l)) } : null
    )
  }, [])

  const deleteLink = useCallback(async (id: number): Promise<void> => {
    await window.electron.ipc.invoke('links:delete', id)
    setDetail((prev) =>
      prev ? { ...prev, links: prev.links.filter((l) => l.id !== id) } : null
    )
  }, [])

  return {
    detail,
    isLoading,
    updateProject,
    snoozeProject,
    createTodo,
    updateTodo,
    deleteTodo,
    createLink,
    updateLink,
    deleteLink,
  }
}
