import { describe, it, expect } from 'vitest'
import { sanitizeMcpText, sanitizeMcpJson } from './sanitize'

const TOKEN = 'super-secret-rotating-token'
const PAT = 'ghp_exampleexampleexampleexample1234'

describe('sanitizeMcpText', () => {
  it('redacts a known secret value', () => {
    expect(sanitizeMcpText(`token is ${TOKEN} ok`, [TOKEN])).toBe('token is [redacted] ok')
  })

  it('redacts multiple secrets', () => {
    const msg = `t=${TOKEN} p=${PAT}`
    expect(sanitizeMcpText(msg, [TOKEN, PAT])).toBe('t=[redacted] p=[redacted]')
  })

  it('ignores trivially short secrets (avoids mangling)', () => {
    expect(sanitizeMcpText('a and b and c', ['a', 'b'])).toBe('a and b and c')
  })

  it('caps very long strings', () => {
    const out = sanitizeMcpText('x'.repeat(5000), [])
    expect(out.length).toBeLessThanOrEqual(2000)
    expect(out.endsWith('…')).toBe(true)
  })

  it('leaves clean text untouched', () => {
    expect(sanitizeMcpText('nothing to hide', [TOKEN])).toBe('nothing to hide')
  })
})

describe('sanitizeMcpJson', () => {
  it('redacts secrets in string leaves', () => {
    expect(sanitizeMcpJson({ msg: `see ${TOKEN}` }, [TOKEN])).toEqual({ msg: 'see [redacted]' })
  })

  it('redacts secrets in arrays', () => {
    expect(sanitizeMcpJson([`${TOKEN}`, 'clean'], [TOKEN])).toEqual(['[redacted]', 'clean'])
  })

  it('redacts secrets that appear in object KEYS', () => {
    const out = sanitizeMcpJson({ [`k-${TOKEN}`]: 1 }, [TOKEN]) as Record<string, unknown>
    expect(Object.keys(out)).toEqual(['k-[redacted]'])
  })

  it('passes through non-string leaves', () => {
    expect(sanitizeMcpJson({ n: 5, b: true, z: null }, [TOKEN])).toEqual({ n: 5, b: true, z: null })
  })

  it('caps recursion depth (returns undefined past the cap)', () => {
    // Build a chain deeper than the internal cap.
    let deep: unknown = 'leaf'
    for (let i = 0; i < 30; i++) deep = { next: deep }
    // Should not throw and should terminate.
    expect(() => sanitizeMcpJson(deep, [])).not.toThrow()
  })

  it('preserves a realistic CallToolResult shape', () => {
    const result = { content: [{ type: 'text', text: 'pong' }], isError: false }
    expect(sanitizeMcpJson(result, [TOKEN])).toEqual(result)
  })
})
