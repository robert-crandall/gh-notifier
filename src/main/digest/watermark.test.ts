import { describe, it, expect } from 'vitest'
import { clampDigestWatermark } from './watermark'

const NOW = new Date('2026-07-02T12:00:00Z')

describe('clampDigestWatermark', () => {
  it('advances to asOf when it is newer than the current watermark', () => {
    const asOf = '2026-07-02T11:00:00.000Z'
    expect(clampDigestWatermark(asOf, '2026-07-01T00:00:00.000Z', NOW)).toBe(asOf)
  })

  it('advances from a null current watermark', () => {
    const asOf = '2026-07-02T11:00:00.000Z'
    expect(clampDigestWatermark(asOf, null, NOW)).toBe(asOf)
  })

  it('does not move the watermark backwards', () => {
    // asOf is older than the current watermark → no change.
    expect(clampDigestWatermark('2026-07-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z', NOW)).toBeNull()
  })

  it('returns null when asOf equals the current watermark', () => {
    const same = '2026-07-02T00:00:00.000Z'
    expect(clampDigestWatermark(same, same, NOW)).toBeNull()
  })

  it('clamps a future asOf to now (defends against a bad client value)', () => {
    const future = '2026-07-05T00:00:00.000Z'
    expect(clampDigestWatermark(future, null, NOW)).toBe(NOW.toISOString())
  })

  it('returns null for an unparseable asOf', () => {
    expect(clampDigestWatermark('not-a-date', null, NOW)).toBeNull()
  })
})
