import { describe, it, expect } from 'vitest'
import { validateMcpServerInput, newMcpServerId } from './mcp-config'

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
