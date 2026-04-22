import { useState, useEffect, useCallback } from 'react'
import type { Project } from '@shared/ipc-channels'

interface UseProjectsResult {
  projects: Project[]
  isLoading: boolean
  createProject: (name: string) => Promise<Project>
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
  }, [loadProjects])

  const createProject = useCallback(async (name: string): Promise<Project> => {
    const project = await window.electron.ipc.invoke('projects:create', name)
    setProjects((prev) => [...prev, project])
    return project
  }, [])

  const deleteProject = useCallback(async (id: number): Promise<void> => {
    await window.electron.ipc.invoke('projects:delete', id)
    setProjects((prev) => prev.filter((p) => p.id !== id))
  }, [])

  return { projects, isLoading, createProject, deleteProject, refreshProjects: loadProjects }
}
