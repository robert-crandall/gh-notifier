import { describe, it, expect } from 'vitest'
import { proposeFromUrl } from './capture'

describe('proposeFromUrl', () => {
  it('recognizes a Datadog dashboard and extracts an external ref', () => {
    const p = proposeFromUrl('https://app.datadoghq.com/dashboard/abc-123-def/checkout-latency?env=prod')
    expect(p.source).toBe('datadog')
    expect(p.kind).toBe('dashboard')
    expect(p.externalRef).toBe('abc-123-def')
    expect(p.env).toBe('prod')
    expect(p.title.toLowerCase()).toContain('checkout')
  })

  it('recognizes GitHub and captures owner/repo', () => {
    const p = proposeFromUrl('https://github.com/acme/widgets/blob/main/README.md')
    expect(p.source).toBe('github')
    expect(p.externalRef).toBe('acme/widgets')
  })

  it('recognizes Splunk as a saved search', () => {
    const p = proposeFromUrl('https://acme.splunkcloud.com/en-US/app/search/report?s=errors')
    expect(p.source).toBe('splunk')
    expect(p.kind).toBe('saved_search')
  })

  it('pulls a service from Datadog tag params', () => {
    const p = proposeFromUrl('https://app.datadoghq.com/dashboard/x/y?tags=service:checkout,env:staging')
    expect(p.service).toBe('checkout')
    expect(p.env).toBe('staging')
  })

  it('falls back to a generic link for an unknown host', () => {
    const p = proposeFromUrl('https://example.test/some/page')
    expect(p.source).toBe('generic')
    expect(p.kind).toBe('link')
    expect(p.url).toBe('https://example.test/some/page')
  })

  it('never throws on a non-URL string', () => {
    const p = proposeFromUrl('not a url')
    expect(p.kind).toBe('link')
    expect(p.title.length).toBeGreaterThan(0)
  })

  it('humanizes a slug title', () => {
    const p = proposeFromUrl('https://example.test/reports/weekly_error_budget')
    expect(p.title).toBe('Weekly error budget')
  })
})
