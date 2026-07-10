/**
 * Defense-in-depth scrub of app secrets from tool OUTPUT before it leaves the
 * process toward the Copilot app. Reintroduced after #99 deleted the original
 * `sanitizeMcpText`/`sanitizeMcpJson`.
 *
 * Trust model (unchanged from the original): this is NOT a hard boundary — it
 * can't catch a secret a handler transforms/encodes. The hard guarantee is that
 * handlers don't put secrets in their output in the first place. This scrub is
 * hygiene on the way out: it redacts any known secret VALUE (the rotating
 * loopback token, the GitHub PAT if present) that slips into a diagnostic string,
 * plus a length cap. Dependency-free so it can also be used inside the shim.
 */

/** Minimum secret length to redact — avoids mangling text on trivial values. */
const MIN_SECRET_LEN = 4

/** Cap on any single sanitized string. */
export const MAX_TEXT_LEN = 2000

/** Max recursion depth for `sanitizeMcpJson` (guards pathological structures). */
const MAX_DEPTH = 24

/**
 * Redact every known secret value from `message` and cap its length. `secrets`
 * is the list of raw secret strings to scrub (token, PAT, …); empty/short
 * entries are ignored. `maxLen` defaults to `MAX_TEXT_LEN` (2000); tools whose
 * output is legitimately large (e.g. reading a runbook) pass a larger cap.
 * Secret redaction always runs BEFORE truncation.
 */
export function sanitizeMcpText(
  message: string,
  secrets: readonly string[],
  maxLen: number = MAX_TEXT_LEN
): string {
  let out = message
  for (const secret of secrets) {
    if (secret.length >= MIN_SECRET_LEN) out = out.split(secret).join('[redacted]')
  }
  return out.length > maxLen ? `${out.slice(0, maxLen - 1)}…` : out
}

/**
 * Recursively scrub known secret values from every string leaf AND object KEY of
 * a JSON value. Depth-capped so a deeply nested structure can't blow the stack.
 * `maxLen` bounds each scrubbed string leaf (default `MAX_TEXT_LEN`).
 */
export function sanitizeMcpJson(
  value: unknown,
  secrets: readonly string[],
  maxLen: number = MAX_TEXT_LEN,
  depth = 0
): unknown {
  if (depth > MAX_DEPTH) return undefined
  if (typeof value === 'string') return sanitizeMcpText(value, secrets, maxLen)
  if (Array.isArray(value)) return value.map((v) => sanitizeMcpJson(v, secrets, maxLen, depth + 1))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[sanitizeMcpText(k, secrets, maxLen)] = sanitizeMcpJson(v, secrets, maxLen, depth + 1)
    }
    return out
  }
  return value
}
