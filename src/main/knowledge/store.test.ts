import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readServiceKnowledge,
  writeServiceKnowledge,
  listServiceHistory,
  knowledgeFilePathForService,
  revealablePathForService,
  pendingWriteChainCount,
  KNOWLEDGE_MAX_BYTES,
  MAX_HISTORY_VERSIONS,
} from './store'

const dirs: string[] = []
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'gh-knowledge-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('read missing', () => {
  it('reports missing for a service with no file', () => {
    const dir = freshDir()
    const res = readServiceKnowledge('web', dir)
    expect(res.status).toBe('missing')
  })
})

describe('write then read (round-trip + stamping)', () => {
  it('writes, stamps source/updated_at, and reads back', async () => {
    const dir = freshDir()
    const w = await writeServiceKnowledge({ service: 'web', markdown: '# Health\n\nHit /health.' }, dir)
    expect(w.status).toBe('ok')

    const r = readServiceKnowledge('web', dir)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.knowledge.source).toBe('copilot')
    expect(r.knowledge.updatedAt).not.toBeNull()
    expect(r.knowledge.frontmatter.service).toBe('web')
    expect(r.knowledge.markdown).toContain('Hit /health.')
  })

  it('normalizes the service name to a single file (case folding)', async () => {
    const dir = freshDir()
    await writeServiceKnowledge({ service: 'API', markdown: 'body' }, dir)
    const r = readServiceKnowledge('api', dir)
    expect(r.status).toBe('ok')
    // Check the actual on-disk name (APFS is case-insensitive, so existsSync of a
    // different-case name would be misleading).
    const files = readdirSync(dir).filter((n) => n.endsWith('.md'))
    expect(files).toEqual(['api.md'])
  })

  it('sees an out-of-band human edit on the next read', async () => {
    const dir = freshDir()
    await writeServiceKnowledge({ service: 'web', markdown: 'original' }, dir)
    // Human edits the file directly on disk.
    const filePath = join(dir, 'web.md')
    const current = readFileSync(filePath, 'utf8')
    writeFileSync(filePath, current + '\nhuman added line\n')
    const r = readServiceKnowledge('web', dir)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect(r.knowledge.markdown).toContain('human added line')
  })
})

describe('env preservation', () => {
  it('preserves a human-set env on a body-only rewrite', async () => {
    const dir = freshDir()
    // Human writes a file with env in frontmatter.
    writeFileSync(join(dir, 'web.md'), '---\nservice: web\nenv: prod\nsource: user\n---\n\nhuman body\n')
    // Copilot rewrites with body only (no frontmatter).
    const w = await writeServiceKnowledge({ service: 'web', markdown: 'new copilot body' }, dir)
    expect(w.status).toBe('ok')
    const r = readServiceKnowledge('web', dir)
    if (r.status === 'ok') {
      expect(r.knowledge.env).toBe('prod')
      expect(r.knowledge.source).toBe('copilot')
      expect(r.knowledge.markdown).toContain('new copilot body')
    }
  })

  it('lets an incoming frontmatter env override the existing one', async () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'web.md'), '---\nservice: web\nenv: prod\n---\nx')
    await writeServiceKnowledge({ service: 'web', markdown: '---\nenv: staging\n---\ny' }, dir)
    const r = readServiceKnowledge('web', dir)
    if (r.status === 'ok') expect(r.knowledge.env).toBe('staging')
  })
})

describe('version history / recoverability', () => {
  it('backs up the prior version before overwriting', async () => {
    const dir = freshDir()
    await writeServiceKnowledge({ service: 'web', markdown: 'v1 content' }, dir)
    expect(listServiceHistory('web', dir)).toHaveLength(0) // first write: no backup

    const w2 = await writeServiceKnowledge({ service: 'web', markdown: 'v2 content' }, dir)
    expect(w2.status === 'ok' && w2.backedUp).toBe(true)
    const history = listServiceHistory('web', dir)
    expect(history).toHaveLength(1)
    expect(readFileSync(history[0], 'utf8')).toContain('v1 content')
  })

  it('prunes history to the most recent N versions', async () => {
    const dir = freshDir()
    for (let i = 0; i < MAX_HISTORY_VERSIONS + 5; i++) {
      await writeServiceKnowledge({ service: 'web', markdown: `version ${i}` }, dir)
    }
    expect(listServiceHistory('web', dir).length).toBeLessThanOrEqual(MAX_HISTORY_VERSIONS)
  })
})

describe('size bounds', () => {
  it('rejects an oversized write', async () => {
    const dir = freshDir()
    const big = 'x'.repeat(KNOWLEDGE_MAX_BYTES + 1)
    const w = await writeServiceKnowledge({ service: 'web', markdown: big }, dir)
    expect(w.status).toBe('too_large')
    expect(existsSync(join(dir, 'web.md'))).toBe(false)
  })

  it('rejects a write whose stamped content would exceed the cap (final-size check)', async () => {
    const dir = freshDir()
    // Body is exactly at the cap; stamped frontmatter pushes the final file over,
    // so the read path would otherwise reject it — the write must fail first.
    const body = 'x'.repeat(KNOWLEDGE_MAX_BYTES)
    const w = await writeServiceKnowledge({ service: 'web', markdown: body }, dir)
    expect(w.status).toBe('too_large')
    expect(existsSync(join(dir, 'web.md'))).toBe(false)
  })

  it('reports too_large for a hand-edited oversized file instead of truncating', () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'web.md'), 'x'.repeat(KNOWLEDGE_MAX_BYTES + 1))
    const r = readServiceKnowledge('web', dir)
    expect(r.status).toBe('too_large')
  })

  it('refuses to overwrite an existing oversized file (no huge read into memory)', async () => {
    const dir = freshDir()
    const big = 'x'.repeat(KNOWLEDGE_MAX_BYTES + 1)
    writeFileSync(join(dir, 'web.md'), big)
    const w = await writeServiceKnowledge({ service: 'web', markdown: 'small new body' }, dir)
    expect(w.status).toBe('blocked')
    // The oversized file must be left untouched (not overwritten, not backed up).
    expect(readFileSync(join(dir, 'web.md'), 'utf8')).toBe(big)
    expect(listServiceHistory('web', dir)).toHaveLength(0)
  })
})

describe('service-name safety (SECURITY)', () => {
  it.each(['../evil', '/etc/passwd', 'a/b', '..', '.hidden', 'has space'])(
    'rejects an unsafe service name %j on write',
    async (bad) => {
      const dir = freshDir()
      const w = await writeServiceKnowledge({ service: bad, markdown: 'x' }, dir)
      expect(w.status).toBe('invalid_service')
    },
  )

  it.each(['../evil', '/etc/passwd', 'a/b', '..'])('rejects an unsafe service name %j on read', (bad) => {
    const dir = freshDir()
    const r = readServiceKnowledge(bad, dir)
    expect(r.status).toBe('invalid_service')
  })

  it('never writes outside the knowledge dir for a traversal attempt', async () => {
    const dir = freshDir()
    const outside = join(dir, '..', 'escaped.md')
    await writeServiceKnowledge({ service: '../escaped', markdown: 'pwned' }, dir)
    expect(existsSync(outside)).toBe(false)
  })

  it('knowledgeFilePathForService returns null for an unsafe name', () => {
    const dir = freshDir()
    expect(knowledgeFilePathForService('../x', dir)).toBeNull()
    expect(knowledgeFilePathForService('web', dir)).toBe(join(dir, 'web.md'))
  })

  it('resolves a valid path even for a root knowledge dir (no double-separator false block)', () => {
    // Pure path computation, no filesystem access.
    expect(knowledgeFilePathForService('web', '/')).toBe('/web.md')
  })
})

describe('symlink refusal (SECURITY)', () => {
  it('refuses to read a symlinked runbook', () => {
    const dir = freshDir()
    const secret = join(dir, 'secret.txt')
    writeFileSync(secret, 'TOP SECRET')
    symlinkSync(secret, join(dir, 'web.md'))
    const r = readServiceKnowledge('web', dir)
    expect(r.status).toBe('blocked')
  })

  it('refuses to overwrite a symlinked runbook', async () => {
    const dir = freshDir()
    const target = join(dir, 'target.txt')
    writeFileSync(target, 'original target')
    symlinkSync(target, join(dir, 'web.md'))
    const w = await writeServiceKnowledge({ service: 'web', markdown: 'x' }, dir)
    expect(w.status).toBe('blocked')
    // The symlink target must be untouched.
    expect(readFileSync(target, 'utf8')).toBe('original target')
  })

  it('refuses to back up into a symlinked history dir', async () => {
    const dir = freshDir()
    await writeServiceKnowledge({ service: 'web', markdown: 'v1' }, dir)
    // Replace .history with a symlink to an outside dir.
    const outside = freshDir()
    rmSync(join(dir, '.history'), { recursive: true, force: true })
    symlinkSync(outside, join(dir, '.history'))
    const w = await writeServiceKnowledge({ service: 'web', markdown: 'v2' }, dir)
    expect(w.status).toBe('backup_failed')
    // The original file must be intact (write aborted).
    const r = readServiceKnowledge('web', dir)
    expect(r.status === 'ok' && r.knowledge.markdown.includes('v1')).toBe(true)
  })

  it('refuses to read through a symlinked knowledge directory', () => {
    const real = freshDir()
    writeFileSync(join(real, 'web.md'), 'secret runbook')
    const linkDir = join(freshDir(), 'knowledge-link')
    symlinkSync(real, linkDir)
    const r = readServiceKnowledge('web', linkDir)
    expect(r.status).toBe('blocked')
  })

  it('revealablePathForService returns a real file path but null for symlinked file/dir', () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'web.md'), 'body')
    expect(revealablePathForService('web', dir)).toBe(join(dir, 'web.md'))
    expect(revealablePathForService('ghost', dir)).toBeNull() // missing

    // Symlinked file -> null.
    const symDir = freshDir()
    symlinkSync(join(dir, 'web.md'), join(symDir, 'web.md'))
    expect(revealablePathForService('web', symDir)).toBeNull()

    // Symlinked knowledge dir -> null.
    const linkDir = join(freshDir(), 'link')
    symlinkSync(dir, linkDir)
    expect(revealablePathForService('web', linkDir)).toBeNull()
  })
})

describe('concurrent writes', () => {
  it('serializes concurrent writes and keeps recoverable history', async () => {
    const dir = freshDir()
    await writeServiceKnowledge({ service: 'web', markdown: 'seed' }, dir)
    // Fire several writes at once.
    await Promise.all(
      Array.from({ length: 8 }, (_v, i) => writeServiceKnowledge({ service: 'web', markdown: `concurrent ${i}` }, dir)),
    )
    const r = readServiceKnowledge('web', dir)
    expect(r.status).toBe('ok')
    // 1 seed + 8 concurrent = 9 writes; 8 of them overwrote an existing file, so
    // 8 backups (all unique, none lost to a race), capped by pruning.
    const history = listServiceHistory('web', dir)
    expect(history.length).toBeGreaterThan(0)
    expect(new Set(history).size).toBe(history.length) // unique backup names
  })

  it('does not leak write-chain entries after writes settle (bounded map)', async () => {
    const dir = freshDir()
    await Promise.all(
      Array.from({ length: 12 }, (_v, i) => writeServiceKnowledge({ service: `svc-${i}`, markdown: 'x' }, dir)),
    )
    // Allow the settle-cleanup microtasks to run.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pendingWriteChainCount()).toBe(0)
  })
})

describe('history dir does not collide with a runbook', () => {
  it('a service literally named "history" is fine; .history stays separate', async () => {
    const dir = freshDir()
    await writeServiceKnowledge({ service: 'history', markdown: 'v1' }, dir)
    await writeServiceKnowledge({ service: 'history', markdown: 'v2' }, dir)
    expect(existsSync(join(dir, 'history.md'))).toBe(true)
    expect(existsSync(join(dir, '.history', 'history'))).toBe(true)
    expect(readServiceKnowledge('history', dir).status).toBe('ok')
  })
})
