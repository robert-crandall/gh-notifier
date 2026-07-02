import type { ReentryDigest } from '../../shared/ipc-channels'
import { computeDigestItems } from './compute'
import { getDigestData } from './queries'

/** Compute the blame-free re-entry digest for a project from existing data. */
export function getDigest(projectId: number): ReentryDigest {
  const { asOf, sessions, notifications } = getDigestData(projectId)
  const items = computeDigestItems({ sessions, notifications })
  return { projectId, asOf, items }
}

export { markProjectFocused, markDigestSeen, dismissResurface } from './store'
