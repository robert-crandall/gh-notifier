import { describe, it, expect } from 'vitest'
import { parseWorkspaceYaml, parseAssertedRepo, isValidSessionId } from './workspace-yaml'

describe('parseWorkspaceYaml', () => {
  it('reads the top-level scalars from a realistic file', () => {
    const yaml = [
      'id: 684bcab0-cd45-497e-ba90-dd94f306be7e',
      'cwd: /Users/me/repos/gh-notifier',
      'git_root: /Users/me/repos/gh-notifier',
      'repository: robert-crandall/gh-notifier',
      'branch: main',
      "name: 'Implement issue #105'",
      'user_named: false',
    ].join('\n')
    expect(parseWorkspaceYaml(yaml)).toEqual({
      id: '684bcab0-cd45-497e-ba90-dd94f306be7e',
      cwd: '/Users/me/repos/gh-notifier',
      repository: 'robert-crandall/gh-notifier',
      name: 'Implement issue #105',
    })
  })

  it('unescapes doubled single quotes in a quoted name', () => {
    const yaml = "name: 'it''s a title'"
    expect(parseWorkspaceYaml(yaml).name).toBe("it's a title")
  })

  it('handles a double-quoted scalar', () => {
    expect(parseWorkspaceYaml('repository: "owner/repo"').repository).toBe('owner/repo')
  })

  it('honors escaped quotes/backslashes inside a double-quoted scalar', () => {
    expect(parseWorkspaceYaml('name: "a \\"quoted\\" b"').name).toBe('a "quoted" b')
    expect(parseWorkspaceYaml('name: "back\\\\slash"').name).toBe('back\\slash')
  })

  it('IGNORES indented (nested) keys — only column-0 keys count', () => {
    const yaml = ['meta:', '  repository: sneaky/nested', '  cwd: /nested/path'].join('\n')
    const parsed = parseWorkspaceYaml(yaml)
    expect(parsed.repository).toBeNull()
    expect(parsed.cwd).toBeNull()
  })

  it('skips full-line comments and blank lines', () => {
    const yaml = ['# a comment', '', 'cwd: /x', '# repository: commented/out'].join('\n')
    const parsed = parseWorkspaceYaml(yaml)
    expect(parsed.cwd).toBe('/x')
    expect(parsed.repository).toBeNull()
  })

  it('first occurrence of a key wins (a later stray line cannot clobber it)', () => {
    expect(parseWorkspaceYaml('cwd: /good\ncwd: /evil').cwd).toBe('/good')
  })

  it('returns nulls for a malformed / unrelated file', () => {
    expect(parseWorkspaceYaml('just some text\nno colons here')).toEqual({
      id: null,
      cwd: null,
      repository: null,
      name: null,
    })
  })

  it('treats an unterminated single-quote as malformed (null)', () => {
    expect(parseWorkspaceYaml("name: 'unterminated").name).toBeNull()
  })

  it('strips a clearly-separated inline comment on an unquoted scalar', () => {
    expect(parseWorkspaceYaml('repository: owner/repo # inline').repository).toBe('owner/repo')
  })

  it('folds a block-scalar name into a single trimmed title', () => {
    const yaml = ['cwd: /x', 'name: |-', '  Implement the thing', '  across two lines', 'user_named: false'].join('\n')
    const parsed = parseWorkspaceYaml(yaml)
    expect(parsed.name).toBe('Implement the thing across two lines')
    expect(parsed.cwd).toBe('/x') // parsing resumed correctly after the block
  })

  it('reads the key AFTER a block scalar (continuation consumption is bounded)', () => {
    const yaml = ['name: |-', '  A multiline', '  title here', 'repository: owner/repo'].join('\n')
    const parsed = parseWorkspaceYaml(yaml)
    expect(parsed.name).toBe('A multiline title here')
    expect(parsed.repository).toBe('owner/repo')
  })

  it('caps an over-long name', () => {
    const long = 'x'.repeat(900)
    expect((parseWorkspaceYaml(`name: '${long}'`).name ?? '').length).toBe(500)
  })
})

describe('parseAssertedRepo', () => {
  it('accepts a clean owner/repo, case-preserved', () => {
    expect(parseAssertedRepo('Robert-Crandall/GH-Notifier')).toEqual({
      owner: 'Robert-Crandall',
      repo: 'GH-Notifier',
    })
  })

  it('rejects null, blanks, extra slashes, whitespace, and control-ish input', () => {
    expect(parseAssertedRepo(null)).toBeNull()
    expect(parseAssertedRepo('')).toBeNull()
    expect(parseAssertedRepo('owner')).toBeNull()
    expect(parseAssertedRepo('owner/repo/extra')).toBeNull()
    expect(parseAssertedRepo('own er/repo')).toBeNull()
    expect(parseAssertedRepo('/repo')).toBeNull()
    expect(parseAssertedRepo('owner/')).toBeNull()
    expect(parseAssertedRepo('../repo')).toBeNull()
    expect(parseAssertedRepo('owner/..')).toBeNull()
  })
})

describe('isValidSessionId', () => {
  it('accepts uuid-shaped ids and rejects unsafe ones', () => {
    expect(isValidSessionId('684bcab0-cd45-497e-ba90-dd94f306be7e')).toBe(true)
    expect(isValidSessionId('abc123')).toBe(true)
    expect(isValidSessionId('')).toBe(false)
    expect(isValidSessionId('../etc/passwd')).toBe(false)
    expect(isValidSessionId('has space')).toBe(false)
    expect(isValidSessionId('a'.repeat(65))).toBe(false)
  })
})
