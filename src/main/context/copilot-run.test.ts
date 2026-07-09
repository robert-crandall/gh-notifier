import { describe, it, expect } from 'vitest'
import { buildDecideArgs, assertDecideArgsSafe, parseDecideOutput, buildDecideEnv } from './copilot-run'

// ── copilot-run: command construction is part of the safety contract ──────────

describe('buildDecideArgs', () => {
  it('runs non-interactively as JSON with no tools / no MCP / no ask', () => {
    const args = buildDecideArgs('the prompt')
    expect(args).toContain('-p')
    expect(args).toContain('the prompt')
    expect(args).toContain('--output-format')
    expect(args).toContain('json')
    expect(args).toContain('--disable-builtin-mcps')
    expect(args).toContain('--no-ask-user')
  })

  it('NEVER grants tools or attaches MCP servers', () => {
    const args = buildDecideArgs('x', { model: 'claude-opus-4.8' })
    expect(args).not.toContain('--allow-all-tools')
    expect(args).not.toContain('--allow-all')
    expect(args).not.toContain('--allow-tool')
    expect(args).not.toContain('--additional-mcp-config')
    // assertion helper agrees
    expect(() => assertDecideArgsSafe(args)).not.toThrow()
  })

  it('pins the model when provided', () => {
    const args = buildDecideArgs('x', { model: 'claude-opus-4.8' })
    const i = args.indexOf('--model')
    expect(i).toBeGreaterThan(-1)
    expect(args[i + 1]).toBe('claude-opus-4.8')
  })

  it('assertDecideArgsSafe throws if a forbidden flag is present', () => {
    expect(() => assertDecideArgsSafe(['--allow-all-tools'])).toThrow(/Unsafe decide flag/)
    expect(() => assertDecideArgsSafe(['--additional-mcp-config=@x.json'])).toThrow(/Unsafe decide flag/)
  })
})

describe('buildDecideEnv (child env is part of the safety contract)', () => {
  const base = { HOME: '/orig', PATH: '/bin', COPILOT_ALLOW_ALL: 'true', COPILOT_HOME: '/parent/.copilot', DD_KEY: 'x' }

  it('forces the isolated HOME and strips parent bypasses', () => {
    const env = buildDecideEnv({ isolatedHome: '/iso' }, base)
    expect(env.HOME).toBe('/iso')
    expect(env.COPILOT_ALLOW_ALL).toBeUndefined() // never inherit tool auto-grant
    expect(env.COPILOT_HOME).toBeUndefined() // don't let config escape the isolated home
    expect(env.PATH).toBe('/bin') // unrelated env is preserved
  })

  it('always strips COPILOT_ALLOW_ALL even without an isolated home', () => {
    const env = buildDecideEnv({}, base)
    expect(env.COPILOT_ALLOW_ALL).toBeUndefined()
  })
})

// ── copilot-run: JSONL parsing ────────────────────────────────────────────────

describe('parseDecideOutput', () => {
  const line = (obj: unknown): string => JSON.stringify(obj)

  it('extracts the last assistant message content', () => {
    const jsonl = [
      line({ type: 'session.mcp_servers_loaded' }),
      line({ type: 'assistant.message', data: { content: '{"verdict":"none"}' } }),
      line({ type: 'result', exitCode: 0 }),
    ].join('\n')
    const r = parseDecideOutput(jsonl)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content).toBe('{"verdict":"none"}')
  })

  it('takes the LAST assistant message when there are several', () => {
    const jsonl = [
      line({ type: 'assistant.message', data: { content: 'first' } }),
      line({ type: 'assistant.message', data: { content: 'final' } }),
    ].join('\n')
    const r = parseDecideOutput(jsonl)
    expect(r.ok && r.content).toBe('final')
  })

  it('reports a reason when no assistant message is present', () => {
    const jsonl = line({ type: 'result', exitCode: 0 })
    const r = parseDecideOutput(jsonl)
    expect(r.ok).toBe(false)
  })

  it('skips non-JSON noise lines defensively', () => {
    const jsonl = ['garbage line', line({ type: 'assistant.message', data: { content: 'ok' } })].join('\n')
    const r = parseDecideOutput(jsonl)
    expect(r.ok && r.content).toBe('ok')
  })

  it('ignores assistant messages with non-string content', () => {
    const jsonl = line({ type: 'assistant.message', data: { content: 42 } })
    expect(parseDecideOutput(jsonl).ok).toBe(false)
  })
})
