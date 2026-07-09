import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  enableMcpJsonEntry,
  disableMcpJsonEntry,
  MANAGED_MARKER_ENV,
  MANAGED_MARKER_VALUE,
  MCP_ENTRY_NAME,
  type ShimCommand,
} from './mcp-json'

const dirs: string[] = []

function tempConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gh-mcp-json-'))
  dirs.push(dir)
  return join(dir, '.mcp.json')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const command: ShimCommand = {
  command: '/path/to/electron',
  args: ['/res/mcp-shim.cjs'],
  env: { ELECTRON_RUN_AS_NODE: '1', [MANAGED_MARKER_ENV]: MANAGED_MARKER_VALUE },
}

function read(path: string): { mcpServers?: Record<string, unknown>; [k: string]: unknown } {
  return JSON.parse(readFileSync(path, 'utf8'))
}

describe('enableMcpJsonEntry', () => {
  it('creates the file + entry when absent', () => {
    const path = tempConfigPath()
    expect(enableMcpJsonEntry(command, path)).toBe('added')
    const cfg = read(path)
    expect(cfg.mcpServers?.[MCP_ENTRY_NAME]).toEqual(command)
  })

  it('writes a new file at mode 0600', () => {
    const path = tempConfigPath()
    enableMcpJsonEntry(command, path)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('is idempotent (second enable updates, no duplicate)', () => {
    const path = tempConfigPath()
    enableMcpJsonEntry(command, path)
    expect(enableMcpJsonEntry(command, path)).toBe('updated')
    const cfg = read(path)
    expect(Object.keys(cfg.mcpServers ?? {})).toEqual([MCP_ENTRY_NAME])
  })

  it('preserves unrelated servers and top-level keys', () => {
    const path = tempConfigPath()
    writeFileSync(
      path,
      JSON.stringify({ mcpServers: { other: { command: 'x' } }, somethingElse: 42 })
    )
    enableMcpJsonEntry(command, path)
    const cfg = read(path)
    expect(cfg.mcpServers?.other).toEqual({ command: 'x' })
    expect(cfg.somethingElse).toBe(42)
    expect(cfg.mcpServers?.[MCP_ENTRY_NAME]).toEqual(command)
  })

  it('refuses to clobber an UNMANAGED entry with our name', () => {
    const path = tempConfigPath()
    const userEntry = { command: 'user-owned', args: [] }
    writeFileSync(path, JSON.stringify({ mcpServers: { [MCP_ENTRY_NAME]: userEntry } }))
    expect(enableMcpJsonEntry(command, path)).toBe('skipped-unmanaged')
    expect(read(path).mcpServers?.[MCP_ENTRY_NAME]).toEqual(userEntry)
  })

  it('updates an entry that already carries our marker', () => {
    const path = tempConfigPath()
    writeFileSync(
      path,
      JSON.stringify({
        mcpServers: {
          [MCP_ENTRY_NAME]: { command: 'old', args: [], env: { [MANAGED_MARKER_ENV]: MANAGED_MARKER_VALUE } },
        },
      })
    )
    expect(enableMcpJsonEntry(command, path)).toBe('updated')
    expect(read(path).mcpServers?.[MCP_ENTRY_NAME]).toEqual(command)
  })

  it('throws (does not clobber) when the existing file is invalid JSON', () => {
    const path = tempConfigPath()
    writeFileSync(path, '{ not valid json')
    expect(() => enableMcpJsonEntry(command, path)).toThrow(/not valid JSON/)
    // Original content untouched.
    expect(readFileSync(path, 'utf8')).toBe('{ not valid json')
  })

  it('throws (does not clobber) when mcpServers is a non-object (array)', () => {
    const path = tempConfigPath()
    writeFileSync(path, JSON.stringify({ mcpServers: ['bogus'] }))
    expect(() => enableMcpJsonEntry(command, path)).toThrow(/mcpServers/)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ mcpServers: ['bogus'] })
  })

  it('throws when the top-level config is a JSON array', () => {
    const path = tempConfigPath()
    writeFileSync(path, JSON.stringify(['nope']))
    expect(() => enableMcpJsonEntry(command, path)).toThrow(/not a JSON object/)
  })
})

describe('disableMcpJsonEntry', () => {
  it('removes our managed entry', () => {
    const path = tempConfigPath()
    enableMcpJsonEntry(command, path)
    expect(disableMcpJsonEntry(path)).toBe('removed')
    expect(read(path).mcpServers?.[MCP_ENTRY_NAME]).toBeUndefined()
  })

  it('preserves other servers when removing ours', () => {
    const path = tempConfigPath()
    writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: 'x' } } }))
    enableMcpJsonEntry(command, path)
    disableMcpJsonEntry(path)
    expect(read(path).mcpServers?.other).toEqual({ command: 'x' })
  })

  it('is a no-op when the file is absent', () => {
    expect(disableMcpJsonEntry(tempConfigPath())).toBe('absent')
  })

  it('is a no-op when our entry is absent', () => {
    const path = tempConfigPath()
    writeFileSync(path, JSON.stringify({ mcpServers: { other: {} } }))
    expect(disableMcpJsonEntry(path)).toBe('absent')
  })

  it('refuses to remove an UNMANAGED entry with our name', () => {
    const path = tempConfigPath()
    const userEntry = { command: 'user-owned' }
    writeFileSync(path, JSON.stringify({ mcpServers: { [MCP_ENTRY_NAME]: userEntry } }))
    expect(disableMcpJsonEntry(path)).toBe('skipped-unmanaged')
    expect(read(path).mcpServers?.[MCP_ENTRY_NAME]).toEqual(userEntry)
  })
})
