import { describe, it, expect } from 'vitest'
import { validateMcpServerInput, validateMcpServerPatch, validateToolName, validateToolArgs, newMcpServerId } from './mcp-config'

describe('validateMcpServerInput', () => {
  it('accepts a well-formed config and normalizes it', () => {
    const r = validateMcpServerInput('  Datadog  ', { command: 'dd-mcp', args: ['--stdio'], env: { KEY: 'v' } })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.label).toBe('Datadog')
      expect(r.value.config).toEqual({ command: 'dd-mcp', args: ['--stdio'], env: { KEY: 'v' } })
    }
  })

  it('defaults missing args/env to empty', () => {
    const r = validateMcpServerInput('X', { command: 'x' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.config).toEqual({ command: 'x', args: [], env: {} })
  })

  it('rejects a missing command', () => {
    expect(validateMcpServerInput('X', { command: '   ' }).ok).toBe(false)
    expect(validateMcpServerInput('X', {}).ok).toBe(false)
  })

  it('rejects an empty/whitespace label', () => {
    expect(validateMcpServerInput('   ', { command: 'x' }).ok).toBe(false)
    expect(validateMcpServerInput('', { command: 'x' }).ok).toBe(false)
  })

  it('rejects a non-object config', () => {
    expect(validateMcpServerInput('X', null).ok).toBe(false)
    expect(validateMcpServerInput('X', 'nope').ok).toBe(false)
  })

  it('rejects a non-object env', () => {
    expect(validateMcpServerInput('X', { command: 'x', env: 'nope' }).ok).toBe(false)
  })

  it('filters non-string args and env values', () => {
    const r = validateMcpServerInput('X', { command: 'x', args: ['ok', 5], env: { A: 'a', B: 2 } })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.config.args).toEqual(['ok'])
      expect(r.value.config.env).toEqual({ A: 'a' })
    }
  })

  it('mints unique ids', () => {
    expect(newMcpServerId()).not.toBe(newMcpServerId())
    expect(newMcpServerId().startsWith('mcp-')).toBe(true)
  })
})

describe('validateMcpServerPatch', () => {
  it('normalizes label/command/args when present', () => {
    const r = validateMcpServerPatch({ label: '  L  ', command: '  c  ', args: ['a'] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toMatchObject({ label: 'L', command: 'c', args: ['a'], envSet: {}, envDelete: [] })
  })

  it('leaves omitted fields undefined (preserve on merge)', () => {
    const r = validateMcpServerPatch({})
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.label).toBeUndefined()
      expect(r.value.command).toBeUndefined()
      expect(r.value.args).toBeUndefined()
      expect(r.value.envSet).toEqual({})
      expect(r.value.envDelete).toEqual([])
    }
  })

  it('rejects empty label/command when explicitly provided', () => {
    expect(validateMcpServerPatch({ label: '  ' }).ok).toBe(false)
    expect(validateMcpServerPatch({ command: '' }).ok).toBe(false)
  })

  it('rejects a key present in both envSet and envDelete', () => {
    const r = validateMcpServerPatch({ envSet: { A: '1' }, envDelete: ['A'] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/both envSet and envDelete/)
  })

  it('rejects invalid env keys and non-string values', () => {
    expect(validateMcpServerPatch({ envSet: { 'A=B': 'x' } }).ok).toBe(false)
    expect(validateMcpServerPatch({ envSet: { '': 'x' } }).ok).toBe(false)
    expect(validateMcpServerPatch({ envSet: { A: 2 as unknown as string } }).ok).toBe(false)
  })

  it('keeps an empty-string value distinct from a delete', () => {
    const r = validateMcpServerPatch({ envSet: { A: '' }, envDelete: ['B'] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.envSet).toEqual({ A: '' })
      expect(r.value.envDelete).toEqual(['B'])
    }
  })
})

describe('validateToolName', () => {
  it('accepts + trims a non-empty name', () => {
    const r = validateToolName('  query  ')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('query')
  })
  it('rejects empty/non-string', () => {
    expect(validateToolName('   ').ok).toBe(false)
    expect(validateToolName(5).ok).toBe(false)
    expect(validateToolName(null).ok).toBe(false)
  })
})

describe('validateToolArgs', () => {
  it('accepts a plain JSON object', () => {
    const r = validateToolArgs({ metric: 'p99', tags: ['a'] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual({ metric: 'p99', tags: ['a'] })
  })
  it('rejects arrays, null, and primitives', () => {
    expect(validateToolArgs([]).ok).toBe(false)
    expect(validateToolArgs(null).ok).toBe(false)
    expect(validateToolArgs('x').ok).toBe(false)
  })
  it('rejects non-JSON-serializable values (BigInt)', () => {
    expect(validateToolArgs({ n: 1n as unknown }).ok).toBe(false)
  })
  it('rejects oversized args', () => {
    expect(validateToolArgs({ blob: 'x'.repeat(20_000) }).ok).toBe(false)
  })
})

describe('validateMcpServerInput env-key validation', () => {
  it('rejects an env key containing = or NUL', () => {
    expect(validateMcpServerInput('X', { command: 'x', env: { 'A=B': 'v' } }).ok).toBe(false)
    expect(validateMcpServerInput('X', { command: 'x', env: { 'A\u0000': 'v' } }).ok).toBe(false)
  })
  it('still accepts normal env keys', () => {
    expect(validateMcpServerInput('X', { command: 'x', env: { DD_API_KEY: 'v' } }).ok).toBe(true)
  })
})

describe('validateToolArgs strictness', () => {
  it('rejects a class instance / Date at the top level', () => {
    expect(validateToolArgs(new Date()).ok).toBe(false)
  })
  it('rejects a nested function or undefined (no silent drop)', () => {
    expect(validateToolArgs({ fn: () => 1 } as unknown).ok).toBe(false)
    expect(validateToolArgs({ u: undefined }).ok).toBe(false)
  })
  it('accepts nested plain JSON', () => {
    const r = validateToolArgs({ a: { b: [1, 'x', true, null] } })
    expect(r.ok).toBe(true)
  })
  it('rejects a cyclic object without stack-overflowing', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(validateToolArgs(cyclic).ok).toBe(false)
  })
})
