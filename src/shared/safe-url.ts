/**
 * Single source of truth for "is this a URL we're willing to open externally?".
 *
 * Shared by the renderer (so free-form text never renders a dead/unsafe link)
 * and the main process (so `app:open-external` never hands a non-http(s) or
 * malformed URL to `shell.openExternal`). Keeping one implementation means the
 * two sides can't drift.
 */

/**
 * Parse a value as a safe external URL. Returns the normalized `href` when the
 * input is a string that parses as an absolute `http:`/`https:` URL, else null.
 *
 * Only http/https are allowed — never `javascript:`, `file:`, `mailto:`, or any
 * custom scheme.
 */
export function parseSafeExternalUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return parsed.href
}

/** True when `url` is a string that parses as an absolute http/https URL. */
export function isSafeExternalUrl(url: unknown): url is string {
  return parseSafeExternalUrl(url) !== null
}
