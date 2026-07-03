import type { Resource, ResourceGroup } from '../../shared/ipc-channels'

/**
 * Computed browse grouping. Structure is machine-derived, never a taxonomy the
 * user maintains: resources group by their pinned override if present, else by
 * source, else by service, else "Other". Grouping is recomputed on every call
 * from the live records — there is no stored group table to groom.
 */

function groupKeyFor(resource: Resource): { key: string; label: string } {
  if (resource.pinnedGroup !== null && resource.pinnedGroup.trim().length > 0) {
    const label = resource.pinnedGroup.trim()
    return { key: `pin:${label.toLowerCase()}`, label }
  }
  if (resource.source && resource.source !== 'generic') {
    return { key: `source:${resource.source.toLowerCase()}`, label: titleCase(resource.source) }
  }
  if (resource.service) {
    return { key: `service:${resource.service.toLowerCase()}`, label: titleCase(resource.service) }
  }
  return { key: 'other', label: 'Other' }
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter((p) => p.length > 0)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

/**
 * Groups resources for the browse view. Groups and the resources within them are
 * sorted deterministically (group by label, resources by title) so the view is
 * stable across renders. Pure.
 */
export function groupResources(resources: Resource[]): ResourceGroup[] {
  const groups = new Map<string, ResourceGroup>()

  for (const resource of resources) {
    const { key, label } = groupKeyFor(resource)
    const existing = groups.get(key)
    if (existing) {
      existing.resources.push(resource)
    } else {
      groups.set(key, { key, label, resources: [resource] })
    }
  }

  const result = Array.from(groups.values())
  for (const group of result) {
    group.resources.sort((a, b) => a.title.localeCompare(b.title) || a.id - b.id)
  }
  // "Other" sinks to the bottom; the rest sort by label.
  result.sort((a, b) => {
    if (a.key === 'other') return 1
    if (b.key === 'other') return -1
    return a.label.localeCompare(b.label)
  })
  return result
}
