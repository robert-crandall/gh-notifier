import { describe, it, expect } from 'vitest'
import {
  EMPTY_CONDITION,
  hasAnyCondition,
  buildRoutingPayload,
  validateRepoRule,
  describeConditions,
} from './rulesForm'

describe('hasAnyCondition', () => {
  it('is false for an empty condition', () => {
    expect(hasAnyCondition(EMPTY_CONDITION)).toBe(false)
  })

  it('ignores whitespace-only values', () => {
    expect(hasAnyCondition({ ...EMPTY_CONDITION, matchReason: '   ' })).toBe(false)
  })

  it('is true when any field has content', () => {
    expect(hasAnyCondition({ ...EMPTY_CONDITION, matchOrg: 'acme' })).toBe(true)
  })
})

describe('buildRoutingPayload', () => {
  it('rejects a rule with no conditions', () => {
    const result = buildRoutingPayload('suppress', EMPTY_CONDITION, null)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/at least one condition/i)
  })

  it('rejects a route rule with no project', () => {
    const result = buildRoutingPayload('route', { ...EMPTY_CONDITION, matchType: 'PullRequest' }, null)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/project/i)
  })

  it('trims values and omits empty ones', () => {
    const result = buildRoutingPayload(
      'suppress',
      { ...EMPTY_CONDITION, matchType: ' PullRequest ', matchReason: '  ' },
      null,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload).toEqual({
        action: 'suppress',
        projectId: undefined,
        matchType: 'PullRequest',
        matchReason: undefined,
        matchRepoOwner: undefined,
        matchRepoName: undefined,
        matchOrg: undefined,
      })
    }
  })

  it('includes the project id for a valid route rule', () => {
    const result = buildRoutingPayload('route', { ...EMPTY_CONDITION, matchOrg: 'acme' }, 7)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.action).toBe('route')
      expect(result.payload.projectId).toBe(7)
      expect(result.payload.matchOrg).toBe('acme')
    }
  })
})

describe('validateRepoRule', () => {
  it('requires owner and name', () => {
    expect(validateRepoRule('', 'repo', 1).ok).toBe(false)
    expect(validateRepoRule('owner', '  ', 1).ok).toBe(false)
  })

  it('requires a project', () => {
    expect(validateRepoRule('owner', 'repo', null).ok).toBe(false)
  })

  it('accepts a complete rule', () => {
    expect(validateRepoRule('owner', 'repo', 1).ok).toBe(true)
  })
})

describe('describeConditions', () => {
  const base = {
    matchType: null,
    matchReason: null,
    matchRepoOwner: null,
    matchRepoName: null,
    matchOrg: null,
  }

  it('summarizes an empty rule as "any thread"', () => {
    expect(describeConditions(base)).toBe('any thread')
  })

  it('joins the set conditions in a stable order', () => {
    expect(
      describeConditions({
        ...base,
        matchType: 'PullRequest',
        matchReason: 'review_requested',
        matchRepoOwner: 'acme',
      }),
    ).toBe('PullRequest · review_requested · acme/*')
  })

  it('renders an org-only rule', () => {
    expect(describeConditions({ ...base, matchOrg: 'acme' })).toBe('org~acme')
  })
})
