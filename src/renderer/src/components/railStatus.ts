import type { Project } from '@shared/ipc-channels'

export type RailTone = 'focused' | 'agent' | 'needs-you' | 'drifting' | 'quiet'

export interface RailStatus {
  tone: RailTone
  pulse: boolean
  /** Short trailing label (e.g. "needs you", "drifting"), or null. */
  label: string | null
}

/**
 * Derive a project's rail status dot from its copilot status + drift state.
 * Copilot activity takes precedence, then drift, then quiet.
 */
export function railStatus(project: Project, isFocused: boolean): RailStatus {
  if (isFocused) return { tone: 'focused', pulse: false, label: null }
  if (project.copilotStatus === 'in_progress') return { tone: 'agent', pulse: true, label: null }
  if (project.copilotStatus === 'waiting' || project.copilotStatus === 'pr_ready') {
    return { tone: 'needs-you', pulse: false, label: 'needs you' }
  }
  if (project.driftState === 'drifting') return { tone: 'drifting', pulse: false, label: 'drifting' }
  return { tone: 'quiet', pulse: false, label: null }
}
