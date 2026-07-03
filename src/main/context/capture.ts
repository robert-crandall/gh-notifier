import type { CaptureProposal, ResourceKind } from '../../shared/ipc-channels'

/**
 * Capture-as-a-byproduct-of-use: turn a pasted/dropped URL into a proposed typed
 * record the user can accept in one tap (undoable). Deterministic + pure — no
 * network. It infers source / kind / service / env / title from the URL shape.
 * Enrichment through a wired MCP server (nicer titles) is a later follow-up.
 */

interface SourceRule {
  source: string
  /** Host substrings that identify this source. */
  hosts: string[]
  /** Default kind for a link from this source. */
  kind: ResourceKind
}

const SOURCE_RULES: SourceRule[] = [
  { source: 'datadog', hosts: ['datadoghq.com', 'datadoghq.eu', 'ddog-gov.com'], kind: 'dashboard' },
  { source: 'splunk', hosts: ['splunkcloud.com', 'splunk.com'], kind: 'saved_search' },
  { source: 'kusto', hosts: ['dataexplorer.azure.com', 'kusto.windows.net'], kind: 'saved_search' },
  { source: 'grafana', hosts: ['grafana.net', 'grafana.com'], kind: 'dashboard' },
  { source: 'github', hosts: ['github.com', 'github.ghe.com'], kind: 'link' },
  { source: 'confluence', hosts: ['atlassian.net', 'confluence'], kind: 'doc' },
  { source: 'notion', hosts: ['notion.so', 'notion.site'], kind: 'doc' },
  { source: 'aws', hosts: ['console.aws.amazon.com', 'aws.amazon.com'], kind: 'link' },
]

const ENV_HINTS = ['prod', 'production', 'staging', 'stage', 'dev', 'development', 'qa', 'test', 'sandbox']

function matchSource(host: string): SourceRule | null {
  const lower = host.toLowerCase()
  for (const rule of SOURCE_RULES) {
    if (rule.hosts.some((h) => lower.includes(h))) return rule
  }
  return null
}

/** Turns a slug-ish string into a human-ish title. */
function humanizeSlug(slug: string): string {
  const cleaned = slug.replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned.length === 0) return ''
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function detectEnv(haystack: string): string {
  const lower = haystack.toLowerCase()
  for (const hint of ENV_HINTS) {
    // Word-ish boundary so "development" doesn't match inside unrelated words.
    if (new RegExp(`(^|[^a-z])${hint}([^a-z]|$)`).test(lower)) {
      if (hint.startsWith('prod')) return 'prod'
      if (hint.startsWith('stag')) return 'staging'
      if (hint.startsWith('dev')) return 'dev'
      return hint
    }
  }
  return ''
}

function tryParseUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/**
 * Proposes a typed record from a URL. Always returns a usable proposal (falls
 * back to a generic link) so capture never blocks on a parse it can't fully do.
 */
export function proposeFromUrl(rawUrl: string): CaptureProposal {
  const trimmed = rawUrl.trim()
  const url = tryParseUrl(trimmed)

  if (url === null) {
    return {
      title: trimmed.slice(0, 120) || 'Saved link',
      kind: 'link',
      source: 'generic',
      service: '',
      env: '',
      url: trimmed.length > 0 ? trimmed : null,
      externalRef: null,
      tags: {},
    }
  }

  const rule = matchSource(url.hostname)
  const source = rule?.source ?? 'generic'
  const kind: ResourceKind = rule?.kind ?? 'link'

  const segments = url.pathname.split('/').filter((s) => s.length > 0)
  const params = url.searchParams

  // Title: a query title param, else the last meaningful path segment, else host.
  const paramTitle = params.get('title') ?? params.get('name') ?? params.get('q')
  const lastSegment = segments.length > 0 ? decodeURIComponent(segments[segments.length - 1]) : ''
  const title =
    (paramTitle && humanizeSlug(paramTitle)) ||
    (lastSegment && humanizeSlug(lastSegment)) ||
    humanizeSlug(url.hostname.split('.')[0]) ||
    'Saved link'

  // Service hint from common query params.
  const service =
    params.get('service') ??
    params.get('env_service') ??
    getTagFromParams(params, 'service') ??
    ''

  const env = params.get('env') ?? detectEnv(`${url.pathname} ${url.search}`)

  // A source-native id when the URL carries one (e.g. dashboard id segment).
  const externalRef = extractExternalRef(source, segments, params)

  const tags: Record<string, string> = {}
  const cluster = params.get('cluster')
  if (cluster) tags.cluster = cluster

  return {
    title,
    kind,
    source,
    service,
    env,
    url: trimmed,
    externalRef,
    tags,
  }
}

function getTagFromParams(params: URLSearchParams, key: string): string | null {
  // Datadog-style tag filters: tags=service:checkout,env:prod
  const tags = params.get('tags') ?? params.get('tpl_var_scope')
  if (!tags) return null
  for (const part of tags.split(/[,]/)) {
    const [k, v] = part.split(':')
    if (k?.trim() === key && v) return v.trim()
  }
  return null
}

function extractExternalRef(source: string, segments: string[], params: URLSearchParams): string | null {
  if (source === 'datadog') {
    // /dashboard/abc-123-def/... -> abc-123-def
    const i = segments.indexOf('dashboard')
    if (i !== -1 && segments[i + 1]) return segments[i + 1]
  }
  if (source === 'github') {
    // owner/repo -> owner/repo
    if (segments.length >= 2) return `${segments[0]}/${segments[1]}`
  }
  const idParam = params.get('id') ?? params.get('sid')
  return idParam ?? null
}
