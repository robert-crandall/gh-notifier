/**
 * Parse a timestamp that may be ISO 8601 (`...T..Z`) or SQLite's `datetime('now')`
 * space format (`YYYY-MM-DD HH:MM:SS`, UTC). Returns epoch ms, or NaN.
 */
export function parseDbTimestampMs(value: string): number {
  if (!value) return NaN
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  return Date.parse(normalized)
}
