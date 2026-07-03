import { describe, it, expect } from 'vitest'
import type { Resource } from '../../shared/ipc-channels'
import { groupResources } from './group'

let nextId = 1
function res(partial: Partial<Resource> & { title: string }): Resource {
  return {
    id: nextId++,
    projectId: 1,
    title: partial.title,
    kind: partial.kind ?? 'dashboard',
    source: partial.source ?? 'generic',
    service: partial.service ?? '',
    env: partial.env ?? '',
    tags: {},
    url: null,
    description: '',
    aliases: [],
    provenance: 'manual',
    confidence: 0.5,
    lastUsed: null,
    lastVerified: null,
    failureCount: 0,
    suspect: false,
    pinnedGroup: partial.pinnedGroup ?? null,
    mcpServer: null,
    toolName: null,
    toolArgs: null,
    externalRef: null,
    validationState: 'unverified',
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('groupResources', () => {
  it('groups by source and sorts groups by label', () => {
    const groups = groupResources([
      res({ title: 'B dash', source: 'datadog' }),
      res({ title: 'A dash', source: 'datadog' }),
      res({ title: 'Search', source: 'splunk' }),
    ])
    expect(groups.map((g) => g.label)).toEqual(['Datadog', 'Splunk'])
    // resources sorted by title within a group
    expect(groups[0].resources.map((r) => r.title)).toEqual(['A dash', 'B dash'])
  })

  it('honors a pinned group override', () => {
    const groups = groupResources([
      res({ title: 'X', source: 'datadog', pinnedGroup: 'Money dashboards' }),
      res({ title: 'Y', source: 'datadog' }),
    ])
    const labels = groups.map((g) => g.label)
    expect(labels).toContain('Money dashboards')
    expect(labels).toContain('Datadog')
  })

  it('falls back to service, then Other, and sinks Other to the bottom', () => {
    const groups = groupResources([
      res({ title: 'svc-scoped', source: 'generic', service: 'checkout' }),
      res({ title: 'orphan', source: 'generic', service: '' }),
    ])
    expect(groups[groups.length - 1].label).toBe('Other')
    expect(groups.some((g) => g.label === 'Checkout')).toBe(true)
  })

  it('returns an empty array for no resources', () => {
    expect(groupResources([])).toEqual([])
  })

  it('normalizes source case/whitespace when grouping', () => {
    const groups = groupResources([
      res({ title: 'A', source: '  datadog  ' }),
      res({ title: 'B', source: 'Datadog' }),
      res({ title: 'C', source: 'Generic', service: 'checkout' }),
    ])
    // Both datadog variants collapse into one group; "Generic" falls back to service.
    const dd = groups.find((g) => g.key === 'source:datadog')
    expect(dd?.resources.map((r) => r.title)).toEqual(['A', 'B'])
    expect(groups.some((g) => g.label === 'Checkout')).toBe(true)
  })
})
