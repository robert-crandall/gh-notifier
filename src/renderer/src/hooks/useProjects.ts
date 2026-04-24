import { useState, useEffect, useCallback } from 'react'
import type { Project, ProjectPatch } from '@shared/ipc-channels'

interface UseProjectsResult {
  projects: Project[]
  isLoading: boolean
  createProject: (name: string) => Promise<Project>
  updateProject: (id: number, patch: ProjectPatch) => Promise<Project>
  deleteProject: (id: number) => Promise<void>
  refreshProjects: () => Promise<void>
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadProjects = useCallback(async () => {
    try {
      const list = await window.electron.ipc.invoke('projects:list')
      setProjects(list)
    } catch (error: unknown) {
      console.error('Failed to load projects:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProjects()
    // Refresh project list (unread counts) whenever a notification sync completes
    const unsub = window.electron.onNotificationsUpdated(() => { void loadProjects() })
    return unsub
  }, [loadProjects])

  const createProject = useCallback(async (name: string): Promise<Project> => {
    const project = await window.electron.ipc.invoke('projects:create', name)
    setProjects((prev) => [...prev, project])
    return project
  }, [])

  const updateProject = useCallback(async (id: number, patch: ProjectPatch): Promise<Project> => {
    const updated = await window.electron.ipc.invoke('projects:update', id, patch)
    setProjects((prev) => prev.map((p) => p.id === id ? { ...p, ...updated } : p))
    return updated
  }, [])

  const deleteProject = useCallback(async (id: number): Promise<void> => {
    await window.electron.ipc.invoke('projects:delete', id)
    setProjects((prev) => prev.filter((p) => p.id !== id))
  }, [])

  return { projects, isLoading, createProject, updateProject, deleteProject, refreshProjects: loadProjects }
}
