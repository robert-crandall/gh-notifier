/**
 * Light frontmatter for per-service runbooks (issue #100). NOT a general YAML
 * parser — the schema is a fixed, tiny set of scalar string fields
 * (`service`, `env`, `updated_at`, `source`), so a constrained line-based
 * `key: value` reader is safer and dependency-free.
 *
 * Detection is deliberately CONSERVATIVE so we never mistake ordinary Markdown
 * (a body that opens with a `---` horizontal rule, say) for frontmatter and
 * silently eat it: a leading `---` block counts as frontmatter ONLY when it is
 * the very first line (after an optional BOM), has a closing `---` fence, EVERY
 * non-empty inner line is a scalar `key: value`, AND at least one recognized key
 * is present. Anything else → the whole input is body.
 *
 * The read tool returns the file's raw bytes; parse/emit here are used to
 * extract metadata for display and to re-stamp on write.
 */

/** Recognized frontmatter fields, mapped to camelCase. Values are raw strings. */
export interface KnowledgeFrontmatter {
  service: string | null
  env: string | null
  updatedAt: string | null
  source: string | null
}

/** A parsed runbook: recognized frontmatter + the remaining body (verbatim). */
export interface ParsedKnowledge {
  frontmatter: KnowledgeFrontmatter
  body: string
}

const EMPTY_FRONTMATTER: KnowledgeFrontmatter = {
  service: null,
  env: null,
  updatedAt: null,
  source: null,
}

/** File keys we understand (snake_case as written on disk). */
const RECOGNIZED = new Set(['service', 'env', 'updated_at', 'source'])

/** Strip a single pair of matching surrounding quotes, if present. */
function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

function mapFrontmatter(parsed: Record<string, string>): KnowledgeFrontmatter {
  return {
    service: parsed.service ?? null,
    env: parsed.env ?? null,
    updatedAt: parsed.updated_at ?? null,
    source: parsed.source ?? null,
  }
}

/**
 * Parse a runbook string into recognized frontmatter + body. When no valid
 * frontmatter block is present the whole input is returned as `body` and
 * `frontmatter` is all-null (never throws — a malformed file must not crash a
 * read).
 */
export function parseKnowledge(raw: string): ParsedKnowledge {
  // Strip a leading BOM for detection only.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw

  // The opening fence must be the very first line.
  const open = /^---[ \t]*\r?\n/.exec(text)
  if (open === null) return { frontmatter: { ...EMPTY_FRONTMATTER }, body: raw }

  // Walk subsequent lines, collecting inner lines until the closing `---` fence.
  const lineRe = /([^\r\n]*)(\r?\n|$)/g
  lineRe.lastIndex = open[0].length
  const innerLines: string[] = []
  let closeEnd = -1
  let match: RegExpExecArray | null
  while ((match = lineRe.exec(text)) !== null) {
    const content = match[1]
    const terminator = match[2]
    if (content.replace(/[ \t]+$/, '') === '---') {
      closeEnd = lineRe.lastIndex
      break
    }
    innerLines.push(content)
    // Reached EOF without a closing fence, or an empty zero-width match: stop.
    if (terminator === '' || match[0] === '') break
  }
  if (closeEnd === -1) return { frontmatter: { ...EMPTY_FRONTMATTER }, body: raw }

  // Every non-empty inner line must be a scalar `key: value`, else this is not
  // our frontmatter — treat the entire input as body.
  const parsed: Record<string, string> = {}
  let recognized = 0
  for (const line of innerLines) {
    if (line.trim() === '') continue
    const kv = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]?(.*)$/.exec(line)
    if (kv === null) return { frontmatter: { ...EMPTY_FRONTMATTER }, body: raw }
    const key = kv[1].toLowerCase()
    parsed[key] = stripQuotes(kv[2].trim())
    if (RECOGNIZED.has(key)) recognized++
  }
  if (recognized === 0) return { frontmatter: { ...EMPTY_FRONTMATTER }, body: raw }

  return { frontmatter: mapFrontmatter(parsed), body: text.slice(closeEnd) }
}

/**
 * Emit a runbook string: a frontmatter block (only non-null fields, fixed order)
 * followed by a single blank-line separator and the body. Leading blank lines in
 * `body` are trimmed so repeated writes don't accumulate whitespace; the result
 * round-trips stably through {@link parseKnowledge}.
 */
export function emitKnowledge(frontmatter: KnowledgeFrontmatter, body: string): string {
  const lines: string[] = []
  if (frontmatter.service !== null) lines.push(`service: ${frontmatter.service}`)
  if (frontmatter.env !== null) lines.push(`env: ${frontmatter.env}`)
  if (frontmatter.updatedAt !== null) lines.push(`updated_at: ${frontmatter.updatedAt}`)
  if (frontmatter.source !== null) lines.push(`source: ${frontmatter.source}`)

  const block = `---\n${lines.join('\n')}\n---\n`
  const trimmedBody = body.replace(/^(?:\r?\n)+/, '')
  return trimmedBody.length > 0 ? `${block}\n${trimmedBody}` : block
}
