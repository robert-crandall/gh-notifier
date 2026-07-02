import { describe, it, expect } from 'vitest'
import { classifyDrift } from './classify'

const NOW = new Date('2026-07-02T12:00:00Z')

function daysBefore(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('classifyDrift', () => {
  it('classifies a snoozed project as parked', () => {
    expect(
      classifyDrift({
        status: 'snoozed',
        lastFocusedAt: daysBefore(0),
        driftSnoozedUntil: null,
        createdAt: daysBefore(30),
        now: NOW,
      })
    ).toBe('parked')
  })

  it('keeps a recently-focused active project active', () => {
    expect(
      classifyDrift({
        status: 'active',
        lastFocusedAt: daysBefore(1),
        driftSnoozedUntil: null,
        createdAt: daysBefore(30),
        now: NOW,
      })
    ).toBe('active')
  })

  it('marks an active project not focused past the threshold as drifting', () => {
    expect(
      classifyDrift({
        status: 'active',
        lastFocusedAt: daysBefore(5),
        driftSnoozedUntil: null,
        createdAt: daysBefore(30),
        now: NOW,
      })
    ).toBe('drifting')
  })

  it('suppresses drifting while within the resurface cooldown ("not now")', () => {
    expect(
      classifyDrift({
        status: 'active',
        lastFocusedAt: daysBefore(10),
        driftSnoozedUntil: daysBefore(-2), // 2 days in the future
        createdAt: daysBefore(30),
        now: NOW,
      })
    ).toBe('active')
  })

  it('resumes drifting once the cooldown has passed', () => {
    expect(
      classifyDrift({
        status: 'active',
        lastFocusedAt: daysBefore(10),
        driftSnoozedUntil: daysBefore(1), // cooldown already ended
        createdAt: daysBefore(30),
        now: NOW,
      })
    ).toBe('drifting')
  })

  it('falls back to createdAt when lastFocusedAt is null', () => {
    expect(
      classifyDrift({
        status: 'active',
        lastFocusedAt: null,
        driftSnoozedUntil: null,
        createdAt: daysBefore(10),
        now: NOW,
      })
    ).toBe('drifting')

    expect(
      classifyDrift({
        status: 'active',
        lastFocusedAt: null,
        driftSnoozedUntil: null,
        createdAt: daysBefore(1),
        now: NOW,
      })
    ).toBe('active')
  })

  it('parses a SQLite space-format timestamp as UTC', () => {
    // 5 days ago, in SQLite datetime('now') format (no T/Z) → should be drifting.
    expect(
      classifyDrift({
        status: 'active',
        lastFocusedAt: '2026-06-27 12:00:00',
        driftSnoozedUntil: null,
        createdAt: '2026-01-01 00:00:00',
        now: NOW,
      })
    ).toBe('drifting')
  })

  it('respects a custom threshold', () => {
    expect(
      classifyDrift({
        status: 'active',
        lastFocusedAt: daysBefore(2),
        driftSnoozedUntil: null,
        createdAt: daysBefore(30),
        now: NOW,
        thresholdDays: 1,
      })
    ).toBe('drifting')
  })
})
