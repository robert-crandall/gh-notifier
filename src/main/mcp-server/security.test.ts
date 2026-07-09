import { describe, it, expect } from 'vitest'
import { authorizeRequest, isLoopbackAddress, MCP_PATH, type RequestMeta } from './security'

const PORT = 4242
const TOKEN = 'the-secret-token'

/** A fully-valid request; individual tests override single fields. */
function okMeta(overrides: Partial<RequestMeta> = {}): RequestMeta {
  return {
    method: 'POST',
    path: MCP_PATH,
    host: `127.0.0.1:${PORT}`,
    origin: undefined,
    authorization: `Bearer ${TOKEN}`,
    remoteAddress: '127.0.0.1',
    ...overrides,
  }
}

function authorize(meta: RequestMeta) {
  return authorizeRequest(meta, { port: PORT, token: TOKEN })
}

describe('isLoopbackAddress', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('accepts loopback %s', (addr) => {
    expect(isLoopbackAddress(addr)).toBe(true)
  })

  it.each(['10.0.0.5', '192.168.1.2', '0.0.0.0', '', null, undefined])(
    'rejects non-loopback %s',
    (addr) => {
      expect(isLoopbackAddress(addr as string | null | undefined)).toBe(false)
    }
  )
})

describe('authorizeRequest', () => {
  it('passes a fully-valid request', () => {
    expect(authorize(okMeta())).toEqual({ ok: true })
  })

  it('404s a wrong path', () => {
    expect(authorize(okMeta({ path: '/other' }))).toMatchObject({ ok: false, status: 404 })
  })

  it('405s a non-POST method', () => {
    expect(authorize(okMeta({ method: 'GET' }))).toMatchObject({ ok: false, status: 405 })
  })

  it('403s a mismatched Host (DNS-rebinding defense)', () => {
    expect(authorize(okMeta({ host: 'evil.example.com' }))).toMatchObject({ ok: false, status: 403 })
    expect(authorize(okMeta({ host: `127.0.0.1:${PORT + 1}` }))).toMatchObject({ ok: false, status: 403 })
    expect(authorize(okMeta({ host: `localhost:${PORT}` }))).toMatchObject({ ok: false, status: 403 })
  })

  it('403s a non-loopback remote address', () => {
    expect(authorize(okMeta({ remoteAddress: '10.0.0.9' }))).toMatchObject({ ok: false, status: 403 })
  })

  it('403s any request carrying an Origin header (browser gate)', () => {
    expect(authorize(okMeta({ origin: 'http://localhost:3000' }))).toMatchObject({ ok: false, status: 403 })
    expect(authorize(okMeta({ origin: 'null' }))).toMatchObject({ ok: false, status: 403 })
  })

  it('401s a missing Authorization header', () => {
    expect(authorize(okMeta({ authorization: undefined }))).toMatchObject({ ok: false, status: 401 })
  })

  it('401s a wrong bearer token', () => {
    expect(authorize(okMeta({ authorization: 'Bearer wrong-token' }))).toMatchObject({ ok: false, status: 401 })
  })

  it('401s a non-bearer Authorization scheme', () => {
    expect(authorize(okMeta({ authorization: `Basic ${TOKEN}` }))).toMatchObject({ ok: false, status: 401 })
  })

  it('accepts a case-insensitive bearer scheme', () => {
    expect(authorize(okMeta({ authorization: `bearer ${TOKEN}` }))).toEqual({ ok: true })
  })

  it('checks path/method before host/token (no info leak ordering)', () => {
    // A wrong path with a bad token should still 404 (path is checked first).
    expect(
      authorize(okMeta({ path: '/nope', authorization: 'Bearer wrong', host: 'evil' }))
    ).toMatchObject({ ok: false, status: 404 })
  })
})
