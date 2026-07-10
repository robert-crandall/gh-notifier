/**
 * Service-name -> knowledge-file KEY normalization + validation. Shared by the
 * main process (the MCP tools + the on-disk knowledge store) and the renderer
 * (the Runbooks surface), so the UI can never disagree with the write path about
 * which service names are addressable as runbooks.
 *
 * SECURITY: a service value becomes a filename (`<key>.md`) under
 * `~/.gh-projects/knowledge/`. This module is the FIRST gate that keeps a write
 * from escaping that directory. It is deliberately REJECT-based (never
 * substitute/slugify): the accepted key maps 1:1 to a filename, and anything
 * that isn't a safe slug is refused with an actionable message rather than
 * silently rewritten into a different (possibly colliding) file. The store layer
 * adds a second, independent containment check as defense-in-depth.
 */

/** Max length of a normalized service key (keeps filenames sane). */
export const MAX_SERVICE_KEY_LENGTH = 64

/**
 * Normalize a raw service name to its canonical key: trim surrounding
 * whitespace and lowercase. NO character substitution — normalization only folds
 * case and trims, so the mapping from an accepted name to a filename is
 * predictable and reversible-by-eye. (Case folding means `API` and `api` share
 * one runbook, by design.)
 */
export function normalizeServiceName(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Outcome of validating a normalized service key. */
export type ServiceNameValidation =
  | { ok: true; key: string }
  | { ok: false; reason: string }

// A safe slug: starts and ends alphanumeric, inner chars limited to
// [a-z0-9._-]. Single-char alphanumeric names are allowed. The start/end anchors
// forbid leading/trailing separators (so no leading `.` hidden files, no
// trailing dot). `..` is rejected separately below because the charset alone
// would otherwise permit it in the middle.
const SAFE_KEY = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/

/**
 * Validate + normalize a raw service name into a safe file key. Rejects (never
 * rewrites) anything unsafe: empty/whitespace, path separators, `..`, leading
 * dots, control chars, non-ASCII, or anything outside the `[a-z0-9._-]` slug
 * charset. Case is folded first, so validation always runs on the same key the
 * store will use. Accepts `unknown` because it gates untrusted MCP/IPC input.
 */
export function validateServiceName(raw: unknown): ServiceNameValidation {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'Service must be a string.' }
  }
  const key = normalizeServiceName(raw)
  if (key.length === 0) {
    return { ok: false, reason: 'Service must not be empty.' }
  }
  if (key.length > MAX_SERVICE_KEY_LENGTH) {
    return { ok: false, reason: `Service must be at most ${MAX_SERVICE_KEY_LENGTH} characters.` }
  }
  // Explicit traversal / separator rejects with clear messages (these would also
  // fail SAFE_KEY, but a targeted message is more useful to the caller).
  if (key.includes('/') || key.includes('\\')) {
    return { ok: false, reason: 'Service must not contain path separators.' }
  }
  if (key.includes('..')) {
    return { ok: false, reason: 'Service must not contain "..".' }
  }
  // Reject any control char or NUL explicitly (belt-and-suspenders vs SAFE_KEY).
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) {
      return { ok: false, reason: 'Service must not contain control characters.' }
    }
  }
  if (!SAFE_KEY.test(key)) {
    return {
      ok: false,
      reason:
        'Service must be a slug of lowercase letters, digits, ".", "-", "_" that starts and ends with a letter or digit (e.g. "payments-api").',
    }
  }
  return { ok: true, key }
}

/** Convenience boolean form of {@link validateServiceName}. */
export function isValidServiceName(raw: unknown): boolean {
  return validateServiceName(raw).ok
}
