import { parseSafeExternalUrl } from '@shared/safe-url'

export interface LinkToken {
  kind: 'text' | 'url'
  /** Displayed text (for a url token, the trimmed URL as it appears in the source). */
  value: string
  /** Offset of this token in the original string — a stable, unique React key. */
  start: number
}

// Candidate URLs: an explicit http/https scheme followed by any run of
// non-whitespace. Requiring a scheme keeps detection unambiguous and avoids
// linkifying bare words like "example.com". Trailing punctuation is stripped
// afterwards by `trimTrailing`, and the candidate is validated as a real
// http/https URL before it's accepted as a link.
const URL_RE = /https?:\/\/\S+/g

// Characters that are almost always sentence/markup punctuation, never a
// meaningful final character of a URL.
const ALWAYS_TRIM = new Set(['.', ',', ';', ':', '!', '?', '"', "'", '<', '>'])

/**
 * Strip trailing characters that are punctuation rather than part of the URL.
 * Closing brackets are only stripped when unbalanced within the candidate, so
 * `…/foo_(bar)` keeps its `)` but `(…/foo)` sheds the trailing one.
 */
function trimTrailing(url: string): string {
  let end = url.length
  while (end > 0) {
    const ch = url[end - 1]
    if (ALWAYS_TRIM.has(ch)) {
      end -= 1
      continue
    }
    if (ch === ')' || ch === ']') {
      const open = ch === ')' ? '(' : '['
      const sub = url.slice(0, end)
      let opens = 0
      let closes = 0
      for (const c of sub) {
        if (c === open) opens += 1
        else if (c === ch) closes += 1
      }
      if (closes > opens) {
        end -= 1
        continue
      }
    }
    break
  }
  return url.slice(0, end)
}

/**
 * Split `text` into an ordered list of plain-text and url tokens. Trailing
 * punctuation trimmed off a URL (and any candidate that isn't a valid http/https
 * URL) stays as text, so nothing from the original string is ever dropped.
 */
export function tokenizeLinks(text: string): LinkToken[] {
  const tokens: LinkToken[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const rawStart = match.index ?? 0
    const trimmed = trimTrailing(match[0])
    // Only accept candidates that parse as real http/https URLs; otherwise leave
    // the text alone so we never render a dead link.
    if (trimmed.length === 0 || parseSafeExternalUrl(trimmed) === null) {
      continue
    }
    if (rawStart > last) {
      tokens.push({ kind: 'text', value: text.slice(last, rawStart), start: last })
    }
    tokens.push({ kind: 'url', value: trimmed, start: rawStart })
    last = rawStart + trimmed.length
  }
  if (last < text.length) {
    tokens.push({ kind: 'text', value: text.slice(last), start: last })
  }
  return tokens
}

/** True when `text` contains at least one linkifiable http/https URL. */
export function hasLink(text: string): boolean {
  return tokenizeLinks(text).some((t) => t.kind === 'url')
}
