import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverWsEndpoint } from './discover'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ws-discover-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('discoverWsEndpoint', () => {
  it('reads the first line of port + token', () => {
    writeFileSync(join(dir, 'ws.port'), '62599\n')
    writeFileSync(join(dir, 'ws.token'), 'abc123token\nignored-second-line')
    expect(discoverWsEndpoint(dir)).toEqual({ port: 62599, token: 'abc123token' })
  })

  it('returns null when files are missing (app not running)', () => {
    expect(discoverWsEndpoint(dir)).toBeNull()
  })

  it('returns null on a non-numeric or out-of-range port', () => {
    writeFileSync(join(dir, 'ws.token'), 'tok')
    writeFileSync(join(dir, 'ws.port'), 'notaport')
    expect(discoverWsEndpoint(dir)).toBeNull()
    writeFileSync(join(dir, 'ws.port'), '99999')
    expect(discoverWsEndpoint(dir)).toBeNull()
  })

  it('returns null on an empty token', () => {
    writeFileSync(join(dir, 'ws.port'), '62599')
    writeFileSync(join(dir, 'ws.token'), '\n\n')
    expect(discoverWsEndpoint(dir)).toBeNull()
  })
})
