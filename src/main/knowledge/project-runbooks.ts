/**
 * Builds the per-project Runbooks view (#100): one {@link ServiceRunbook} per
 * service on the project card, read fresh from disk. Deduped by normalized key so
 * `API` and `api` don't show twice, and honest about services whose card name
 * isn't a valid runbook key. Read-only (uses the non-lazy card read) so surfacing
 * runbooks never mutates state.
 */

import type { ServiceRunbook } from '../../shared/ipc-channels'
import { normalizeServiceName, validateServiceName } from '../../shared/service-name'
import { getProjectCardReadOnly } from '../context/registry'
import { readServiceKnowledge } from './store'

export function listRunbooksForProject(projectId: number): ServiceRunbook[] {
  const card = getProjectCardReadOnly(projectId)
  const seen = new Set<string>()
  const out: ServiceRunbook[] = []

  for (const raw of card.services) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    const v = validateServiceName(trimmed)
    // Dedupe by the filename key when valid; otherwise by the folded raw name so
    // repeated invalid entries collapse too.
    const dedupeKey = v.ok ? v.key : `invalid:${normalizeServiceName(trimmed)}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    if (!v.ok) {
      out.push({
        service: trimmed,
        key: null,
        status: 'invalid',
        reason: v.reason,
        markdown: null,
        env: null,
        updatedAt: null,
        source: null,
      })
      continue
    }

    const res = readServiceKnowledge(trimmed)
    switch (res.status) {
      case 'ok':
        out.push({
          service: trimmed,
          key: v.key,
          status: 'ok',
          reason: null,
          markdown: res.knowledge.markdown,
          env: res.knowledge.env,
          updatedAt: res.knowledge.updatedAt,
          source: res.knowledge.source,
        })
        break
      case 'missing':
        out.push({ service: trimmed, key: v.key, status: 'missing', reason: null, markdown: null, env: null, updatedAt: null, source: null })
        break
      case 'too_large':
        out.push({
          service: trimmed,
          key: v.key,
          status: 'too_large',
          reason: `File is ${res.size} bytes, too large to display here — edit it on disk.`,
          markdown: null,
          env: null,
          updatedAt: null,
          source: null,
        })
        break
      case 'blocked':
        out.push({ service: trimmed, key: v.key, status: 'blocked', reason: res.reason, markdown: null, env: null, updatedAt: null, source: null })
        break
      case 'invalid_service':
        out.push({ service: trimmed, key: null, status: 'invalid', reason: res.reason, markdown: null, env: null, updatedAt: null, source: null })
        break
    }
  }

  return out
}
