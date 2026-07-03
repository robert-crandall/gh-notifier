import { describe, it, expect } from 'vitest'
import {
  normalizeRemoteToOwnerRepo,
  remotesMatchRepo,
  resolveLocalCwd,
  expandHome,
  type GitInspection,
} from './cwd'
import { homedir } from 'node:os'
import { join } from 'node:path'

describe('normalizeRemoteToOwnerRepo', () => {
  it('handles https, scp, ssh, and bare forms, case-insensitively', () => {
    expect(normalizeRemoteToOwnerRepo('https://github.com/Owner/Repo.git')).toBe('owner/repo')
    expect(normalizeRemoteToOwnerRepo('https://github.com/owner/repo')).toBe('owner/repo')
    expect(normalizeRemoteToOwnerRepo('git@github.com:owner/repo.git')).toBe('owner/repo')
    expect(normalizeRemoteToOwnerRepo('ssh://git@github.com/owner/repo.git')).toBe('owner/repo')
    // GHE host works too (host-agnostic)
    expect(normalizeRemoteToOwnerRepo('https://github.example.com/owner/repo')).toBe('owner/repo')
  })

  it('rejects nested paths so a deeper remote cannot false-match owner/repo', () => {
    // Only an exact two-segment owner/repo is trusted.
    expect(normalizeRemoteToOwnerRepo('https://host/a/b/owner/repo.git')).toBeNull()
    expect(normalizeRemoteToOwnerRepo('https://gitlab.example.com/acme/owner/repo.git')).toBeNull()
    expect(normalizeRemoteToOwnerRepo('git@host:acme/owner/repo.git')).toBeNull()
    expect(normalizeRemoteToOwnerRepo('acme/owner/repo')).toBeNull()
  })

  it('rejects empty/doubled segments (no collapsing) and partial owner/repo', () => {
    expect(normalizeRemoteToOwnerRepo('https://host//owner/repo.git')).toBeNull()
    expect(normalizeRemoteToOwnerRepo('https://host/owner//repo.git')).toBeNull()
    expect(normalizeRemoteToOwnerRepo('git@host:/owner/repo.git')).toBeNull()
    expect(normalizeRemoteToOwnerRepo('owner/')).toBeNull()
  })

  it('accepts a valid remote with a trailing slash after .git', () => {
    expect(normalizeRemoteToOwnerRepo('https://github.com/owner/repo.git/')).toBe('owner/repo')
    expect(normalizeRemoteToOwnerRepo('https://github.com/owner/repo/')).toBe('owner/repo')
  })

  it('returns null for non-repo urls', () => {
    expect(normalizeRemoteToOwnerRepo('')).toBeNull()
    expect(normalizeRemoteToOwnerRepo('justowner')).toBeNull()
    expect(normalizeRemoteToOwnerRepo('https://host/only')).toBeNull()
  })
})

describe('remotesMatchRepo', () => {
  it('matches when any remote normalizes to owner/repo', () => {
    expect(remotesMatchRepo(['git@github.com:me/foo.git'], 'me', 'foo')).toBe(true)
    expect(remotesMatchRepo(['https://github.com/ME/FOO'], 'me', 'foo')).toBe(true)
  })
  it('does not match a different owner (the owner-collision guard)', () => {
    expect(remotesMatchRepo(['https://github.com/someoneelse/foo'], 'me', 'foo')).toBe(false)
    expect(remotesMatchRepo([], 'me', 'foo')).toBe(false)
  })
})

describe('expandHome', () => {
  it('expands ~ and ~/...', () => {
    expect(expandHome('~')).toBe(homedir())
    expect(expandHome('~/repos')).toBe(join(homedir(), 'repos'))
    expect(expandHome('/abs/path')).toBe('/abs/path')
  })
})

describe('resolveLocalCwd', () => {
  const matchingGit: GitInspection = { insideWorkTree: true, remoteUrls: ['git@github.com:me/foo.git'] }

  it('resolves <repos-root>/<repo> when it exists, is a worktree, and the remote matches', async () => {
    const res = await resolveLocalCwd('me', 'foo', {
      reposRoot: '/repos',
      dirProbe: (p) => p === '/repos/foo',
      gitInspector: async () => matchingGit,
    })
    expect(res).toEqual({ ok: true, cwd: '/repos/foo' })
  })

  it('rejects when the path is not a directory', async () => {
    const res = await resolveLocalCwd('me', 'foo', {
      reposRoot: '/repos',
      dirProbe: () => false,
      gitInspector: async () => matchingGit,
    })
    expect(res).toEqual({ ok: false, reason: 'no_local_cwd' })
  })

  it('rejects when the directory is not a git worktree', async () => {
    const res = await resolveLocalCwd('me', 'foo', {
      reposRoot: '/repos',
      dirProbe: () => true,
      gitInspector: async () => ({ insideWorkTree: false, remoteUrls: [] }),
    })
    expect(res).toEqual({ ok: false, reason: 'no_local_cwd' })
  })

  it('rejects when the remote points at a different owner (owner collision)', async () => {
    const res = await resolveLocalCwd('me', 'foo', {
      reposRoot: '/repos',
      dirProbe: () => true,
      gitInspector: async () => ({ insideWorkTree: true, remoteUrls: ['git@github.com:someoneelse/foo.git'] }),
    })
    expect(res).toEqual({ ok: false, reason: 'no_local_cwd' })
  })

  it('uses an explicit override path over the convention', async () => {
    const seen: string[] = []
    const res = await resolveLocalCwd('me', 'foo', {
      reposRoot: '/repos',
      overridePath: '/custom/checkout',
      dirProbe: (p) => { seen.push(p); return p === '/custom/checkout' },
      gitInspector: async () => matchingGit,
    })
    expect(res).toEqual({ ok: true, cwd: '/custom/checkout' })
    expect(seen).toContain('/custom/checkout')
    expect(seen).not.toContain('/repos/foo')
  })
})
