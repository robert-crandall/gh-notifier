import { describe, it, expect } from 'vitest'
import { generateToken, timingSafeEqualToken } from './token'

describe('generateToken', () => {
  it('produces a 43-char base64url token (32 bytes, no padding)', () => {
    const token = generateToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(token).not.toContain('=')
  })

  it('rotates: two calls produce different tokens', () => {
    expect(generateToken()).not.toBe(generateToken())
  })
})

describe('timingSafeEqualToken', () => {
  it('returns true for identical tokens', () => {
    const token = generateToken()
    expect(timingSafeEqualToken(token, token)).toBe(true)
  })

  it('returns false for different tokens of equal length', () => {
    expect(timingSafeEqualToken('a'.repeat(43), 'b'.repeat(43))).toBe(false)
  })

  it('returns false for different-length tokens without throwing', () => {
    expect(timingSafeEqualToken('short', 'a-much-longer-token')).toBe(false)
  })

  it('returns false when one side is empty', () => {
    expect(timingSafeEqualToken('', 'nonempty')).toBe(false)
  })
})
