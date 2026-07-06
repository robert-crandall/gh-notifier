import { describe, it, expect } from 'vitest'
import { parseSafeExternalUrl, isSafeExternalUrl } from './safe-url'

describe('parseSafeExternalUrl', () => {
  it('accepts http and https and returns the normalized href', () => {
    expect(parseSafeExternalUrl('https://example.com')).toBe('https://example.com/')
    expect(parseSafeExternalUrl('http://example.com/path?q=1')).toBe('http://example.com/path?q=1')
  })

  it('rejects non-http(s) schemes', () => {
    expect(parseSafeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(parseSafeExternalUrl('file:///etc/passwd')).toBeNull()
    expect(parseSafeExternalUrl('mailto:a@b.com')).toBeNull()
    expect(parseSafeExternalUrl('vscode://open')).toBeNull()
    expect(parseSafeExternalUrl('ftp://host/file')).toBeNull()
  })

  it('rejects malformed / relative / non-string input', () => {
    expect(parseSafeExternalUrl('not a url')).toBeNull()
    expect(parseSafeExternalUrl('https://')).toBeNull()
    expect(parseSafeExternalUrl('/relative/path')).toBeNull()
    expect(parseSafeExternalUrl('')).toBeNull()
    expect(parseSafeExternalUrl(null)).toBeNull()
    expect(parseSafeExternalUrl(undefined)).toBeNull()
    expect(parseSafeExternalUrl(42)).toBeNull()
    expect(parseSafeExternalUrl({ href: 'https://x.com' })).toBeNull()
  })
})

describe('isSafeExternalUrl', () => {
  it('is a boolean mirror of parseSafeExternalUrl', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl(null)).toBe(false)
  })
})
