import { describe, it, expect } from 'vitest'
import { parseAndValidateDecision } from './verdict-contract'
import { buildDecideArgs, assertDecideArgsSafe, parseDecideOutput } from './copilot-run'

// ── verdict-contract: the safety validator ────────────────────────────────────

const ALLOWED = ['c1', 'c2', 'c3']

describe('parseAndValidateDecision', () => {
  it('accepts a confident verdict citing an allowed candidate', () => {
    const r = parseAndValidateDecision('{"verdict":"confident","citedCandidateId":"c2"}', ALLOWED)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.decision.verdict).toBe('confident')
      expect(r.decision.citedCandidateId).toBe('c2')
    }
  })

  it('rejects a confident verdict citing an UNKNOWN candidate (out of candidate set)', () => {
    const r = parseAndValidateDecision('{"verdict":"confident","citedCandidateId":"c9"}', ALLOWED)
    expect(r.ok).toBe(false)
  })

  it('rejects a confident verdict with a missing citation', () => {
    const r = parseAndValidateDecision('{"verdict":"confident"}', ALLOWED)
    expect(r.ok).toBe(false)
  })

  it('accepts a clarify with a question', () => {
    const r = parseAndValidateDecision('{"verdict":"clarify","clarifyQuestion":"prod or staging?"}', ALLOWED)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.decision.clarifyQuestion).toBe('prod or staging?')
  })

  it('filters clarify candidateIds down to the allowed set', () => {
    const r = parseAndValidateDecision(
      '{"verdict":"clarify","candidateIds":["c1","c9","c3"]}',
      ALLOWED
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.decision.candidateIds).toEqual(['c1', 'c3'])
  })

  it('rejects a clarify with neither a question nor valid candidates', () => {
    const r = parseAndValidateDecision('{"verdict":"clarify","candidateIds":["c9"]}', ALLOWED)
    expect(r.ok).toBe(false)
  })

  it('accepts none', () => {
    const r = parseAndValidateDecision('{"verdict":"none"}', ALLOWED)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.decision.verdict).toBe('none')
  })

  it('rejects malformed JSON', () => {
    expect(parseAndValidateDecision('not json at all', ALLOWED).ok).toBe(false)
  })

  it('rejects prose-wrapped JSON', () => {
    const r = parseAndValidateDecision('Sure! Here is the answer: {"verdict":"none"}', ALLOWED)
    expect(r.ok).toBe(false)
  })

  it('rejects a JSON array (not an object)', () => {
    expect(parseAndValidateDecision('["verdict","none"]', ALLOWED).ok).toBe(false)
  })

  it('rejects an unknown verdict value', () => {
    expect(parseAndValidateDecision('{"verdict":"definitely"}', ALLOWED).ok).toBe(false)
  })

  it('rejects empty output', () => {
    expect(parseAndValidateDecision('   ', ALLOWED).ok).toBe(false)
  })

  it('ignores extra fields on an otherwise valid verdict', () => {
    const r = parseAndValidateDecision(
      '{"verdict":"confident","citedCandidateId":"c1","liveValue":"p99 240ms","note":"ignore me"}',
      ALLOWED
    )
    // liveValue from the model is IGNORED — the app owns the read. The decision is still valid.
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.decision.citedCandidateId).toBe('c1')
  })
})

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
