import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { ACCENTS, COLOR_MODES, DENSITIES } from './useTheme'

// The pre-paint bootstrap (public/theme-bootstrap.js) is a plain script that runs
// before the module bundle, so it can't import from useTheme. This guards against
// the two drifting apart: every allowed value + storage key useTheme relies on must
// also be present in the bootstrap, or first paint will use the wrong attributes.
const source = readFileSync(resolve(process.cwd(), 'src/renderer/public/theme-bootstrap.js'), 'utf8')

describe('theme-bootstrap parity with useTheme', () => {
  it('references the same localStorage keys', () => {
    for (const key of ['focus-color-mode', 'focus-accent', 'focus-density']) {
      expect(source).toContain(key)
    }
  })

  it('allows every color mode useTheme allows', () => {
    for (const mode of COLOR_MODES) {
      expect(source).toContain(`'${mode}'`)
    }
  })

  it('allows every accent and density useTheme allows', () => {
    for (const value of [...ACCENTS, ...DENSITIES]) {
      expect(source).toContain(`'${value}'`)
    }
  })

  it('resolves system via prefers-color-scheme and sets the real attributes', () => {
    expect(source).toContain('prefers-color-scheme: dark')
    expect(source).toContain('data-color-mode')
    expect(source).toContain('data-accent')
    expect(source).toContain('data-density')
  })
})
