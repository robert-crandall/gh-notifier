import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { extractToolText, interpretCallResult, createMcpRunner, listMcpTools, sanitizeMcpJson } from './mcp-client'
import type { McpStdioConfig } from '../../shared/ipc-channels'

// ── Pure interpretation ───────────────────────────────────────────────────────

describe('extractToolText', () => {
  it('joins text blocks and ignores non-text', () => {
    const result = { content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }
    expect(extractToolText(result)).toBe('a\nb')
  })
  it('returns empty for malformed input', () => {
    expect(extractToolText(null)).toBe('')
    expect(extractToolText({})).toBe('')
    expect(extractToolText({ content: 'nope' })).toBe('')
  })
})

describe('interpretCallResult', () => {
  it('returns ok with the joined value', () => {
    const r = interpretCallResult({ content: [{ type: 'text', text: 'p99 = 240ms' }] })
    expect(r.ok).toBe(true)
    expect(r.value).toBe('p99 = 240ms')
  })
  it('classifies empty content as no_data (bad source)', () => {
    const r = interpretCallResult({ content: [] })
    expect(r.ok).toBe(false)
    expect(r.failure).toBe('no_data')
  })
  it('classifies an error result as query_invalid (bad source)', () => {
    const r = interpretCallResult({ content: [{ type: 'text', text: 'percentile disabled' }], isError: true })
    expect(r.ok).toBe(false)
    expect(r.failure).toBe('query_invalid')
  })
  it('classifies an auth error as auth_missing (bad infra, not the source)', () => {
    const r = interpretCallResult({ content: [{ type: 'text', text: '401 Unauthorized' }], isError: true })
    expect(r.failure).toBe('auth_missing')
  })
  it('does NOT misclassify a service-name-containing query error as auth (authnd/authzd)', () => {
    const r = interpretCallResult({ content: [{ type: 'text', text: 'query invalid for authnd: percentile disabled' }], isError: true })
    expect(r.failure).toBe('query_invalid')
  })
  it('treats explicit permission-denied as auth_missing', () => {
    const r = interpretCallResult({ content: [{ type: 'text', text: 'permission denied' }], isError: true })
    expect(r.failure).toBe('auth_missing')
  })
})

// ── End-to-end against the synthetic echo MCP server ──────────────────────────

const echoServer = (): McpStdioConfig => ({
  command: process.execPath, // node
  args: [join(__dirname, 'eval', 'echo-mcp-server.mjs')],
  env: {},
})

describe('createMcpRunner (app-owned read, end-to-end)', () => {
  it('reads a live value from the echo tool', async () => {
    const runner = createMcpRunner({ timeoutMs: 15_000 })
    const r = await runner.run(echoServer(), 'echo', { metric: 'checkout.p99', value: '240ms' })
    expect(r.ok).toBe(true)
    expect(r.value).toContain('checkout.p99 = 240ms')
  }, 20_000)

  it('maps an empty tool result to no_data', async () => {
    const runner = createMcpRunner({ timeoutMs: 15_000 })
    const r = await runner.run(echoServer(), 'empty', {})
    expect(r.ok).toBe(false)
    expect(r.failure).toBe('no_data')
  }, 20_000)

  it('maps a tool error to query_invalid', async () => {
    const runner = createMcpRunner({ timeoutMs: 15_000 })
    const r = await runner.run(echoServer(), 'fail', {})
    expect(r.ok).toBe(false)
    expect(r.failure).toBe('query_invalid')
  }, 20_000)

  it('maps a bad command to connector_down (not a source failure)', async () => {
    const runner = createMcpRunner({ timeoutMs: 8_000 })
    const r = await runner.run({ command: 'definitely-not-a-real-binary-xyz', args: [], env: {} }, 'echo', {})
    expect(r.ok).toBe(false)
    expect(r.failure).toBe('connector_down')
  }, 12_000)
})

describe('listMcpTools (honest connection probe)', () => {
  it('starts the server and discovers its tools', async () => {
    const r = await listMcpTools(echoServer(), { timeoutMs: 15_000 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const names = r.tools.map((t) => t.name)
      expect(names).toContain('echo')
      expect(names).toContain('empty')
      expect(names).toContain('fail')
    }
  }, 20_000)

  it('returns a sanitized error for a bad command (no crash)', async () => {
    const r = await listMcpTools({ command: 'definitely-not-a-real-binary-xyz', args: [], env: {} }, { timeoutMs: 8_000 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(typeof r.error).toBe('string')
  }, 12_000)

  it('redacts a configured secret value from the error message', async () => {
    const secret = 'supersecrettoken12345'
    const r = await listMcpTools(
      { command: 'definitely-not-a-real-binary-xyz', args: [], env: { TOKEN: secret } },
      { timeoutMs: 8_000 }
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).not.toContain(secret)
  }, 12_000)
})

describe('sanitizeMcpJson', () => {
  it('scrubs configured secret values from both string leaves AND object keys', () => {
    const env = { TOKEN: 'supersecrettoken12345' }
    const schema = {
      supersecrettoken12345: 'inside a key',
      description: 'value has supersecrettoken12345 in it',
      nested: { arr: ['supersecrettoken12345'] },
    }
    const out = sanitizeMcpJson(schema, env)
    expect(JSON.stringify(out)).not.toContain('supersecrettoken12345')
  })
  it('passes through non-secret content unchanged in shape', () => {
    const out = sanitizeMcpJson({ type: 'object', n: 5, ok: true }, {})
    expect(out).toEqual({ type: 'object', n: 5, ok: true })
  })
})
