/**
 * Parse a timestamp that may be ISO 8601 (`...T..Z`) or SQLite's `datetime('now')`
 * space format (`YYYY-MM-DD HH:MM:SS`, UTC, no tz marker). Returns epoch ms, or NaN.
 *
 * SQLite's space format has no timezone designator; JS would otherwise parse it as
 * local time. We treat it as UTC (which is what SQLite emits). Shared between the
 * main and renderer processes so the normalization never diverges.
 */
export function parseDbTimestampMs(value: string): number {
  if (!value) return NaN
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  return Date.parse(normalized)
}
