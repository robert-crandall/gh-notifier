import { describe, it, expect } from 'vitest'
import { tokenizeLinks, hasLink } from './linkify'

/** Compact helper: render tokens as an array of [kind, value] pairs. */
function shape(text: string): Array<[string, string]> {
  return tokenizeLinks(text).map((t) => [t.kind, t.value])
}

describe('tokenizeLinks', () => {
  it('returns a single text token for plain text', () => {
    expect(shape('just some text')).toEqual([['text', 'just some text']])
  })

  it('returns [] for an empty string', () => {
    expect(tokenizeLinks('')).toEqual([])
  })

  it('linkifies a bare URL', () => {
    expect(shape('https://example.com/foo')).toEqual([['url', 'https://example.com/foo']])
  })

  it('splits text around a URL', () => {
    expect(shape('see https://example.com now')).toEqual([
      ['text', 'see '],
      ['url', 'https://example.com'],
      ['text', ' now'],
    ])
  })

  it('trims a trailing period into the following text token', () => {
    expect(shape('see https://x.com.')).toEqual([
      ['text', 'see '],
      ['url', 'https://x.com'],
      ['text', '.'],
    ])
  })

  it('trims a trailing comma and keeps the offset of the comma', () => {
    const tokens = tokenizeLinks('see https://x.com, then continue')
    expect(tokens.map((t) => [t.kind, t.value])).toEqual([
      ['text', 'see '],
      ['url', 'https://x.com'],
      ['text', ', then continue'],
    ])
    // The trailing text token starts at the comma, not the following space.
    expect(tokens[2].start).toBe('see https://x.com'.length)
  })

  it('handles two space-separated URLs', () => {
    expect(shape('https://a.com https://b.com')).toEqual([
      ['url', 'https://a.com'],
      ['text', ' '],
      ['url', 'https://b.com'],
    ])
  })

  it('trims an unbalanced closing paren', () => {
    expect(shape('(https://x.com/foo)')).toEqual([
      ['text', '('],
      ['url', 'https://x.com/foo'],
      ['text', ')'],
    ])
  })

  it('keeps a balanced closing paren inside the URL', () => {
    expect(shape('https://x.com/foo_(bar)')).toEqual([['url', 'https://x.com/foo_(bar)']])
  })

  it('trims only the surplus closing paren', () => {
    expect(shape('https://x.com/foo(bar))')).toEqual([
      ['url', 'https://x.com/foo(bar)'],
      ['text', ')'],
    ])
  })

  it('trims a trailing bracket', () => {
    expect(shape('[https://x.com/foo]')).toEqual([
      ['text', '['],
      ['url', 'https://x.com/foo'],
      ['text', ']'],
    ])
  })

  it('strips angle brackets around a URL', () => {
    expect(shape('<https://x.com>')).toEqual([
      ['text', '<'],
      ['url', 'https://x.com'],
      ['text', '>'],
    ])
  })

  it('keeps query and hash parts', () => {
    expect(shape('https://x.com/p?q=1&r=2#frag')).toEqual([
      ['url', 'https://x.com/p?q=1&r=2#frag'],
    ])
  })

  it('does not linkify non-http(s) schemes', () => {
    expect(shape('run javascript:alert(1) now')).toEqual([['text', 'run javascript:alert(1) now']])
    expect(shape('open file:///etc/passwd')).toEqual([['text', 'open file:///etc/passwd']])
  })

  it('does not linkify a scheme with no host', () => {
    expect(shape('broken https://) link')).toEqual([['text', 'broken https://) link']])
  })

  it('gives duplicate URLs distinct, offset-based keys', () => {
    const tokens = tokenizeLinks('https://x.com https://x.com')
    const urls = tokens.filter((t) => t.kind === 'url')
    expect(urls).toHaveLength(2)
    expect(urls[0].start).not.toBe(urls[1].start)
  })
})

describe('hasLink', () => {
  it('detects a link', () => {
    expect(hasLink('go to https://x.com')).toBe(true)
  })

  it('is false for plain text', () => {
    expect(hasLink('no links here')).toBe(false)
  })

  it('is false for an invalid candidate', () => {
    expect(hasLink('https:// nope')).toBe(false)
  })
})
