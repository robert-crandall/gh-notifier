import { describe, it, expect } from 'vitest'
import { normalizeServiceName, validateServiceName, isValidServiceName } from './service-name'

describe('normalizeServiceName', () => {
  it('trims and lowercases only (no substitution)', () => {
    expect(normalizeServiceName('  Payments-API  ')).toBe('payments-api')
    expect(normalizeServiceName('WEB')).toBe('web')
  })
})

describe('validateServiceName - accepts safe slugs', () => {
  it.each([
    'web',
    'payments-api',
    'web_store',
    'a',
    'a1',
    'service.v2',
    'foo-bar_baz.qux',
    '  Payments-API  ', // normalized to payments-api
  ])('accepts %j', (raw) => {
    const res = validateServiceName(raw)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.key).toMatch(/^[a-z0-9]/)
      expect(isValidServiceName(raw)).toBe(true)
    }
  })

  it('folds case to a single key', () => {
    const a = validateServiceName('API')
    const b = validateServiceName('api')
    expect(a.ok && b.ok && a.key === b.key).toBe(true)
  })
})

describe('validateServiceName - rejects traversal / unsafe input (SECURITY)', () => {
  it.each([
    '',
    '   ',
    '.',
    '..',
    '../foo',
    '../../etc/passwd',
    '..\\windows',
    'foo/bar',
    'foo\\bar',
    '/etc/passwd',
    '/absolute',
    'a/../b',
    '.hidden', // leading dot
    'foo.', // trailing dot
    '-foo', // leading separator
    'foo-', // trailing separator
    '_foo',
    'foo/',
    'foo..bar', // contains ..
    'a\u0000b', // NUL byte
    'a\tb', // control char
    'a\nb',
    'café', // non-ASCII
    'Ω',
    'has space',
    'UPPER/lower', // slash survives lowercasing
  ])('rejects %j', (raw) => {
    expect(validateServiceName(raw).ok).toBe(false)
    expect(isValidServiceName(raw)).toBe(false)
  })

  it('rejects an over-length name', () => {
    expect(validateServiceName('a'.repeat(65)).ok).toBe(false)
    expect(validateServiceName('a'.repeat(64)).ok).toBe(true)
  })

  it('gives an actionable reason on rejection', () => {
    const res = validateServiceName('../evil')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason.length).toBeGreaterThan(0)
  })
})
