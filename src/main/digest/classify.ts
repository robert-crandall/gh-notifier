import type { DriftState, ProjectStatus } from '../../shared/ipc-channels'
import { DRIFT_THRESHOLD_DAYS, MS_PER_DAY } from './constants'
import { parseDbTimestampMs } from './time'

export interface ClassifyDriftInput {
  status: ProjectStatus
  /** ISO 8601 (or SQLite datetime). The drift anchor. */
  lastFocusedAt: string | null
  /** ISO 8601 cooldown end for "not now". */
  driftSnoozedUntil: string | null
  /** Fallback anchor when lastFocusedAt is null (rare after backfill). */
  createdAt: string
  now: Date
  /** Days of inactivity before an active project is considered drifting. */
  thresholdDays?: number
}

/**
 * Classify a project's peripheral-memory state. Pure.
 * - snoozed → parked
 * - active + within its resurface cooldown → active (suppressed from drifting)
 * - active + not focused for `thresholdDays` → drifting
 * - otherwise → active
 */
export function classifyDrift(input: ClassifyDriftInput): DriftState {
  if (input.status === 'snoozed') return 'parked'

  const nowMs = input.now.getTime()

  if (input.driftSnoozedUntil !== null) {
    const cooldownMs = parseDbTimestampMs(input.driftSnoozedUntil)
    if (!Number.isNaN(cooldownMs) && cooldownMs > nowMs) return 'active'
  }

  const anchor = input.lastFocusedAt ?? input.createdAt
  const anchorMs = parseDbTimestampMs(anchor)
  if (Number.isNaN(anchorMs)) return 'active'

  const thresholdDays = input.thresholdDays ?? DRIFT_THRESHOLD_DAYS
  const ageMs = nowMs - anchorMs
  return ageMs > thresholdDays * MS_PER_DAY ? 'drifting' : 'active'
}
