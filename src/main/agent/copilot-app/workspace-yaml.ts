/**
 * Minimal, defensive parser for the desktop app's per-session `workspace.yaml`.
 *
 * This file is part of the app's UNOFFICIAL on-disk layout, so we don't pull in a
 * YAML dependency and we never trust its shape. We extract only the handful of
 * TOP-LEVEL scalar keys we need — `id`, `cwd`, `repository`, `name` — and fail
 * closed (null) on anything unexpected. Nested/indented keys are deliberately
 * ignored (only column-0 keys count), so a `repository:` buried inside some nested
 * mapping can't be mistaken for the session's repo.
 *
 * Verified against real files (see the #119 spike): keys appear unindented as
 * `key: value`, with `name` typically a single-quoted single line.
 */

/** The scalar fields we read out of a workspace.yaml. Each is null when absent/blank. */
export interface WorkspaceYaml {
  id: string | null
  cwd: string | null
  repository: string | null
  name: string | null
}

const WANTED = new Set(['id', 'cwd', 'repository', 'name'])
/** Defensive cap on the cosmetic `name`/title so a giant block scalar can't bloat storage. */
const MAX_NAME = 500

/**
 * If a scalar value is a YAML block-scalar indicator (`|`, `>`, with optional
 * chomping/indent like `|-`), fold the following indented lines into a single
 * trimmed string. Returns the folded text plus the index of the last consumed
 * line, or undefined when `rawValue` isn't a block indicator.
 */
function tryBlockScalar(
  rawValue: string,
  lines: string[],
  keyIndex: number
): { text: string | null; lastIndex: number } | undefined {
  if (!/^[|>][+-]?\d*$/.test(rawValue.trim())) return undefined
  const collected: string[] = []
  let j = keyIndex + 1
  for (; j < lines.length; j++) {
    const l = lines[j] ?? ''
    if (l.trim().length === 0) {
      collected.push('') // blank line — still inside the block
      continue
    }
    if (/^\s/.test(l)) {
      collected.push(l) // indented — inside the block
      continue
    }
    break // a non-indented, non-blank line ends the block
  }
  const nonBlank = collected.filter((l) => l.length > 0)
  if (nonBlank.length === 0) return { text: null, lastIndex: j - 1 }
  const minIndent = Math.min(...nonBlank.map((l) => (/^\s*/.exec(l)?.[0].length ?? 0)))
  const folded = nonBlank
    .map((l) => l.slice(minIndent))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { text: folded.length > 0 ? folded : null, lastIndex: j - 1 }
}

/**
 * Unquote a YAML scalar value. Handles single-quoted (with `''` → `'` escaping)
 * and double-quoted (with basic `\"`/`\\` escaping) forms; otherwise returns the
 * trimmed raw text. Returns null for an empty result.
 */
function unquoteScalar(raw: string): string | null {
  const s = raw.trim()
  if (s.length === 0) return null

  if (s.startsWith("'")) {
    // Single-quoted: scan to the closing quote; a doubled `''` is a literal quote.
    let out = ''
    let i = 1
    let closed = false
    while (i < s.length) {
      const ch = s[i]
      if (ch === "'") {
        if (s[i + 1] === "'") {
          out += "'"
          i += 2
          continue
        }
        closed = true
        break
      }
      out += ch
      i += 1
    }
    if (!closed) return null // no closing quote → malformed
    return out.length > 0 ? out : null
  }

  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1)
    if (end === -1) return null
    const body = s.slice(1, end).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    return body.length > 0 ? body : null
  }

  // Unquoted scalar: strip a trailing inline comment only when clearly separated
  // (" #"), which never appears in a cwd/owner-repo but keeps a commented YAML tidy.
  const hashIdx = s.search(/\s#/)
  const body = (hashIdx === -1 ? s : s.slice(0, hashIdx)).trim()
  return body.length > 0 ? body : null
}

/**
 * Parse a workspace.yaml's text into the scalar fields we care about. Only
 * column-0 `key: value` lines with a wanted key are considered; everything else
 * (indented keys, comments, block scalars, other keys) is ignored. Never throws.
 */
export function parseWorkspaceYaml(text: string): WorkspaceYaml {
  const out: WorkspaceYaml = { id: null, cwd: null, repository: null, name: null }
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    // Top-level only: no leading whitespace, not a comment.
    if (line.length === 0 || /^\s/.test(line) || line.startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    if (!WANTED.has(key)) continue
    const k = key as keyof WorkspaceYaml
    // First occurrence wins; don't let a later stray line clobber a good value.
    if (out[k] !== null) continue
    const rawValue = line.slice(colon + 1)
    const block = tryBlockScalar(rawValue, lines, i)
    if (block !== undefined) {
      out[k] = block.text
      i = block.lastIndex // skip the consumed continuation lines
    } else {
      out[k] = unquoteScalar(rawValue)
    }
  }
  if (out.name !== null && out.name.length > MAX_NAME) out.name = out.name.slice(0, MAX_NAME)
  return out
}

/**
 * Validate + normalize an asserted `owner/repo` slug from workspace.yaml.
 * Case-PRESERVED (so `repo_rules`' exact match still works). Returns null unless
 * it's exactly two non-empty segments of safe characters — no extra slashes, no
 * whitespace, no control/structural characters. This value is used ONLY for
 * project mapping/display; it is never fed into command execution or file access.
 */
export function parseAssertedRepo(repository: string | null): { owner: string; repo: string } | null {
  if (repository === null) return null
  const s = repository.trim()
  // owner and repo: GitHub-safe characters only.
  const m = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(s)
  if (m === null) return null
  const owner = m[1]
  const repo = m[2]
  if (owner === undefined || repo === undefined) return null
  // Reject "." / ".." path-ish segments defensively.
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null
  return { owner, repo }
}

/** A desktop-app session id is a bounded uuid-shaped / alphanumeric-dash token. */
export function isValidSessionId(id: string): boolean {
  return /^[A-Za-z0-9-]{1,64}$/.test(id)
}
