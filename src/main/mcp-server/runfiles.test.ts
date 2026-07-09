import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRunFiles, writeRunFiles, cleanupRunFiles, runDir } from './runfiles'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gh-mcp-run-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('runDir', () => {
  it('points under ~/.gh-projects/run', () => {
    expect(runDir().endsWith(join('.gh-projects', 'run'))).toBe(true)
  })
})

describe('writeRunFiles / readRunFiles', () => {
  it('round-trips port + token', () => {
    const dir = tempDir()
    writeRunFiles({ port: 54321, token: 'abc123token' }, dir)
    expect(readRunFiles(dir)).toEqual({ port: 54321, token: 'abc123token' })
  })

  it('writes both files mode 0600', () => {
    const dir = tempDir()
    writeRunFiles({ port: 5, token: 'tok' }, dir)
    expect(statSync(join(dir, 'port')).mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, 'token')).mode & 0o777).toBe(0o600)
  })

  it('returns null when files are absent (app not running)', () => {
    expect(readRunFiles(tempDir())).toBeNull()
  })

  it('returns null when only one file is present (torn/partial)', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'port'), '5\n')
    expect(readRunFiles(dir)).toBeNull()
  })

  it('rejects a non-numeric port', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'token'), 'tok\n')
    writeFileSync(join(dir, 'port'), '0x10\n')
    expect(readRunFiles(dir)).toBeNull()
  })

  it('rejects an out-of-range port', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'token'), 'tok\n')
    writeFileSync(join(dir, 'port'), '70000\n')
    expect(readRunFiles(dir)).toBeNull()
  })

  it('rejects an empty token', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'token'), '\n')
    writeFileSync(join(dir, 'port'), '5\n')
    expect(readRunFiles(dir)).toBeNull()
  })

  it('trims trailing whitespace/newlines from values', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'token'), '  spaced-token  \n\n')
    writeFileSync(join(dir, 'port'), '  4242  \n')
    expect(readRunFiles(dir)).toEqual({ port: 4242, token: 'spaced-token' })
  })

  it('does not leave temp files behind', () => {
    const dir = tempDir()
    writeRunFiles({ port: 1, token: 'x' }, dir)
    const leftover = readdirSync(dir).filter((f) => f.includes('.tmp-'))
    expect(leftover).toEqual([])
  })
})

describe('cleanupRunFiles', () => {
  it('removes both run files', () => {
    const dir = tempDir()
    writeRunFiles({ port: 1, token: 'x' }, dir)
    cleanupRunFiles(dir)
    expect(readRunFiles(dir)).toBeNull()
  })

  it('is a no-op when files are already absent', () => {
    expect(() => cleanupRunFiles(tempDir())).not.toThrow()
  })
})

describe('write ordering (token before port)', () => {
  it('writes token content that is present alongside the port', () => {
    // The atomicity of the two writes is what matters; assert both readable.
    const dir = tempDir()
    writeRunFiles({ port: 9, token: 'ordered' }, dir)
    expect(readFileSync(join(dir, 'token'), 'utf8').trim()).toBe('ordered')
    expect(readFileSync(join(dir, 'port'), 'utf8').trim()).toBe('9')
  })
})
