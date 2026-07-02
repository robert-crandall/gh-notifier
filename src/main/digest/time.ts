import { MS_PER_DAY } from './constants'

/**
 * Parse a timestamp that may be either ISO 8601 (our new columns: `...T..Z`) or
 * SQLite's `datetime('now')` format (`YYYY-MM-DD HH:MM:SS`, UTC, no tz marker).
 * Returns epoch milliseconds, or NaN if unparseable.
 *
 * SQLite's space format has no timezone designator; JS would otherwise parse it
 * as local time. We treat it as UTC (which is what SQLite emits) so comparisons
 * against ISO values are correct regardless of the host timezone.
 */
export function parseDbTimestampMs(value: string): number {
  if (!value) return NaN
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  return Date.parse(normalized)
}

/** ISO 8601 UTC string for a point in time `days` before `now`. */
export function daysAgoIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString()
}
