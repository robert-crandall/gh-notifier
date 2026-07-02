import { describe, it, expect } from 'vitest'
import { computeDigestItems, type DigestNotificationRow, type DigestSessionRow } from './compute'

function session(overrides: Partial<DigestSessionRow> = {}): DigestSessionRow {
  return {
    id: 's1',
    status: 'completed',
    title: 'Wire the retry backoff',
    htmlUrl: 'https://github.com/o/r/issues/1',
    linkedPrUrl: null,
    ...overrides,
  }
}

function notif(overrides: Partial<DigestNotificationRow> = {}): DigestNotificationRow {
  return {
    id: 'n1',
    type: 'PullRequest',
    reason: 'subscribed',
    title: 'Some PR',
    htmlUrl: 'https://github.com/o/r/pull/1',
    ...overrides,
  }
}

describe('computeDigestItems', () => {
  it('returns no items when there is nothing to catch up on', () => {
    expect(computeDigestItems({ sessions: [], notifications: [] })).toEqual([])
  })

  it('labels a pr_ready session as ready to review and links the PR', () => {
    const [item] = computeDigestItems({
      sessions: [session({ status: 'pr_ready', linkedPrUrl: 'https://github.com/o/r/pull/9' })],
      notifications: [],
    })
    expect(item.kind).toBe('agent-pr-ready')
    expect(item.tone).toBe('success')
    expect(item.href).toBe('https://github.com/o/r/pull/9')
    expect(item.text).toContain('ready to review')
  })

  it('labels waiting / completed / in_progress sessions distinctly', () => {
    const items = computeDigestItems({
      sessions: [
        session({ id: 'a', status: 'waiting' }),
        session({ id: 'b', status: 'completed' }),
        session({ id: 'c', status: 'in_progress' }),
      ],
      notifications: [],
    })
    expect(items.map((i) => i.kind)).toEqual(['agent-waiting', 'agent-completed', 'agent-in-progress'])
    expect(items[0].tone).toBe('attention')
  })

  it('falls back to "a task" when a session has no title', () => {
    const [item] = computeDigestItems({
      sessions: [session({ title: '   ' })],
      notifications: [],
    })
    expect(item.text).toContain('a task')
  })

  it('surfaces review-requested notifications individually', () => {
    const [item] = computeDigestItems({
      sessions: [],
      notifications: [notif({ reason: 'review_requested', title: 'Add jitter' })],
    })
    expect(item.kind).toBe('notification-review')
    expect(item.text).toContain('Review requested')
    expect(item.href).toBe('https://github.com/o/r/pull/1')
  })

  it('groups non-review notifications into a single counted bullet', () => {
    const items = computeDigestItems({
      sessions: [],
      notifications: [notif({ id: 'n1' }), notif({ id: 'n2' }), notif({ id: 'n3' })],
    })
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('notifications-grouped')
    expect(items[0].count).toBe(3)
    expect(items[0].text).toBe('3 notifications routed here.')
  })

  it('uses singular copy for a single grouped notification', () => {
    const [item] = computeDigestItems({ sessions: [], notifications: [notif()] })
    expect(item.text).toBe('1 notification routed here.')
  })

  it('caps individual reviews at 3 and folds the rest into the group', () => {
    const reviews = Array.from({ length: 5 }, (_, i) =>
      notif({ id: `r${i}`, reason: 'review_requested', title: `Review ${i}` })
    )
    const items = computeDigestItems({ sessions: [], notifications: reviews })
    const individual = items.filter((i) => i.kind === 'notification-review')
    const grouped = items.filter((i) => i.kind === 'notifications-grouped')
    expect(individual).toHaveLength(3)
    expect(grouped).toHaveLength(1)
    expect(grouped[0].count).toBe(2)
  })

  it('orders sessions first, then reviews, then the grouped notifications', () => {
    const items = computeDigestItems({
      sessions: [session({ status: 'completed' })],
      notifications: [
        notif({ id: 'rev', reason: 'review_requested' }),
        notif({ id: 'other', reason: 'subscribed' }),
      ],
    })
    expect(items.map((i) => i.kind)).toEqual([
      'agent-completed',
      'notification-review',
      'notifications-grouped',
    ])
  })
})
