import { describe, it, expect } from 'vitest'
import { parseKnowledge, emitKnowledge } from './frontmatter'

describe('parseKnowledge', () => {
  it('parses a standard frontmatter block + body', () => {
    const raw = '---\nservice: web\nenv: prod\nupdated_at: 2026-07-09T00:00:00.000Z\nsource: copilot\n---\n\n# How to check health\n\nPing the /health endpoint.\n'
    const { frontmatter, body } = parseKnowledge(raw)
    expect(frontmatter).toEqual({
      service: 'web',
      env: 'prod',
      updatedAt: '2026-07-09T00:00:00.000Z',
      source: 'copilot',
    })
    expect(body).toContain('# How to check health')
    expect(body).toContain('Ping the /health endpoint.')
  })

  it('tolerates quoted values and extra whitespace', () => {
    const raw = "---\nservice:   \"web\"  \nsource: 'user'\n---\nbody"
    const { frontmatter } = parseKnowledge(raw)
    expect(frontmatter.service).toBe('web')
    expect(frontmatter.source).toBe('user')
  })

  it('ignores unknown keys but still parses when a recognized key is present', () => {
    const raw = '---\nservice: web\nowner: alice\n---\nbody'
    const { frontmatter } = parseKnowledge(raw)
    expect(frontmatter.service).toBe('web')
  })

  it('strips a leading BOM before detecting frontmatter', () => {
    const raw = '\uFEFF---\nservice: web\n---\nbody'
    expect(parseKnowledge(raw).frontmatter.service).toBe('web')
  })

  it('does NOT treat a body that opens with a --- horizontal rule as frontmatter', () => {
    const raw = '---\nThis is a real paragraph, not key: value.\nMore prose here.\n---\nrest'
    const { frontmatter, body } = parseKnowledge(raw)
    expect(frontmatter.service).toBeNull()
    // The whole input is preserved as body.
    expect(body).toBe(raw)
  })

  it('does not treat a --- block with only unknown keys as our frontmatter', () => {
    const raw = '---\nfoo: bar\nbaz: qux\n---\nbody'
    const { frontmatter, body } = parseKnowledge(raw)
    expect(frontmatter.service).toBeNull()
    expect(body).toBe(raw)
  })

  it('returns all-null frontmatter and full body when there is no frontmatter', () => {
    const raw = '# Just a heading\n\nSome prose.'
    const { frontmatter, body } = parseKnowledge(raw)
    expect(frontmatter).toEqual({ service: null, env: null, updatedAt: null, source: null })
    expect(body).toBe(raw)
  })

  it('treats an unclosed fence as body (never throws)', () => {
    const raw = '---\nservice: web\nno closing fence'
    const { frontmatter, body } = parseKnowledge(raw)
    expect(frontmatter.service).toBeNull()
    expect(body).toBe(raw)
  })
})

describe('emitKnowledge', () => {
  it('emits recognized fields in fixed order with a body separator', () => {
    const out = emitKnowledge(
      { service: 'web', env: 'prod', updatedAt: '2026-07-09T00:00:00.000Z', source: 'copilot' },
      'Body text',
    )
    expect(out).toBe(
      '---\nservice: web\nenv: prod\nupdated_at: 2026-07-09T00:00:00.000Z\nsource: copilot\n---\n\nBody text',
    )
  })

  it('omits null fields (e.g. no env)', () => {
    const out = emitKnowledge({ service: 'web', env: null, updatedAt: '2026-07-09T00:00:00.000Z', source: 'copilot' }, 'x')
    expect(out).not.toContain('env:')
    expect(out).toContain('service: web')
  })

  it('trims leading blank lines from the body so repeated writes do not accumulate', () => {
    const first = emitKnowledge({ service: 'web', env: null, updatedAt: 't', source: 'copilot' }, '\n\n\nBody')
    const reparsed = parseKnowledge(first)
    const second = emitKnowledge({ service: 'web', env: null, updatedAt: 't', source: 'copilot' }, reparsed.body)
    expect(first).toBe(second)
  })
})

describe('round-trip', () => {
  it('parse(emit(x)) preserves recognized frontmatter and body', () => {
    const fm = { service: 'payments-api', env: 'staging', updatedAt: '2026-07-09T12:00:00.000Z', source: 'user' as const }
    const body = '# Runbook\n\n1. Check the [prod latency dashboard]\n2. Look at logs\n'
    const parsed = parseKnowledge(emitKnowledge(fm, body))
    expect(parsed.frontmatter).toEqual(fm)
    expect(parsed.body).toContain('# Runbook')
    expect(parsed.body).toContain('[prod latency dashboard]')
  })
})
