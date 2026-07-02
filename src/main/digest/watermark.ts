import { parseDbTimestampMs } from './time'

/**
 * Compute the value to write to a project's `digest_seen_at` when the user
 * dismisses the digest. Pure so it can be unit-tested.
 *
 * `asOf` is the ReentryDigest.asOf captured at digest:get time (always ISO). We
 * only advance the watermark forward and never past `now`:
 *   - future asOf  → clamp to now (defends against a bad client value)
 *   - asOf <= current watermark → return null (don't move backwards)
 *   - otherwise    → asOf
 *
 * Returns the ISO string to persist, or null to leave the watermark unchanged.
 */
export function clampDigestWatermark(asOf: string, currentSeenAt: string | null, now: Date): string | null {
  const parsed = parseDbTimestampMs(asOf)
  if (Number.isNaN(parsed)) return null

  // Never advance past now (defends against a future/bad asOf from the client).
  const asOfMs = Math.min(parsed, now.getTime())

  // Never move the watermark backwards, even if the stored value is in the
  // future (clock skew / corruption).
  if (currentSeenAt !== null) {
    const currentMs = parseDbTimestampMs(currentSeenAt)
    if (!Number.isNaN(currentMs) && asOfMs <= currentMs) return null
  }

  return new Date(asOfMs).toISOString()
}
