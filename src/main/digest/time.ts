import { MS_PER_DAY } from './constants'

export { parseDbTimestampMs } from '../../shared/time'

/** ISO 8601 UTC string for a point in time `days` before `now`. */
export function daysAgoIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString()
}
