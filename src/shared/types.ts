// Domain types shared between main process and renderer.

export interface Project {
  id: number
  name: string
  notes: string
  nextAction: string
  status: 'active' | 'snoozed'
  position: number
  createdAt: string
  updatedAt: string
}

export interface ProjectLink {
  id: number
  projectId: number
  label: string
  url: string
  position: number
}

export interface ProjectTodo {
  id: number
  projectId: number
  title: string
  done: boolean
  position: number
  createdAt: string
}

// Partial types for update operations (excludes immutable fields)
export type ProjectUpdate = Pick<Project, 'name' | 'notes' | 'nextAction' | 'status' | 'position'>
export type ProjectLinkUpdate = Pick<ProjectLink, 'label' | 'url' | 'position'>
export type ProjectTodoUpdate = Pick<ProjectTodo, 'title' | 'done' | 'position'>
