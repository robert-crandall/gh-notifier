import { describe, it, expect } from 'vitest'
import {
  buildCreateSession,
  buildSendMessage,
  buildDeleteSession,
  encodeFrame,
  parseFrame,
} from './protocol'

describe('protocol builders', () => {
  it('builds create_session with and without a model', () => {
    expect(buildCreateSession('/tmp/x')).toEqual({ type: 'create_session', cwd: '/tmp/x' })
    expect(buildCreateSession('/tmp/x', 'gpt-5-mini')).toEqual({
      type: 'create_session',
      cwd: '/tmp/x',
      model: 'gpt-5-mini',
    })
    // blank model is dropped
    expect(buildCreateSession('/tmp/x', '   ')).toEqual({ type: 'create_session', cwd: '/tmp/x' })
  })

  it('builds send_message and delete_session', () => {
    expect(buildSendMessage('s1', 'hi')).toEqual({ type: 'send_message', session_id: 's1', prompt: 'hi' })
    expect(buildDeleteSession('s1')).toEqual({ type: 'delete_session', session_id: 's1' })
  })

  it('encodes frames to JSON', () => {
    expect(JSON.parse(encodeFrame(buildDeleteSession('s1')))).toEqual({ type: 'delete_session', session_id: 's1' })
  })
})

describe('parseFrame', () => {
  it('parses server_hello with instance_id', () => {
    expect(parseFrame('{"type":"server_hello","instance_id":"abc"}')).toEqual({
      kind: 'server_hello',
      instanceId: 'abc',
    })
  })

  it('parses session_created / session_deleted with an id', () => {
    expect(parseFrame('{"type":"session_created","session_id":"s1","cwd":"/x"}')).toEqual({
      kind: 'session_created',
      sessionId: 's1',
    })
    expect(parseFrame('{"type":"session_deleted","session_id":"s1"}')).toEqual({
      kind: 'session_deleted',
      sessionId: 's1',
    })
  })

  it('treats an id-less session_created as ambient (not a real create)', () => {
    expect(parseFrame('{"type":"session_created"}')).toEqual({ kind: 'other', type: 'session_created' })
  })

  it('parses session_event and preserves its session_id for filtering', () => {
    expect(parseFrame('{"type":"session_event","session_id":"s2","x":1}')).toEqual({
      kind: 'session_event',
      sessionId: 's2',
    })
    expect(parseFrame('{"type":"session_event"}')).toEqual({ kind: 'session_event', sessionId: null })
  })

  it('maps ambient/unknown frames to other without throwing', () => {
    expect(parseFrame('{"type":"keep_awake_changed","enabled":true}')).toEqual({
      kind: 'other',
      type: 'keep_awake_changed',
    })
    expect(parseFrame('not json')).toEqual({ kind: 'other', type: '<unparseable>' })
    expect(parseFrame('123')).toEqual({ kind: 'other', type: '<non-object>' })
    expect(parseFrame('{"noType":1}')).toEqual({ kind: 'other', type: '<untyped>' })
  })
})
