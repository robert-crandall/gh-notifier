import { describe, it, expect } from 'vitest'
import { buildThreadUrl } from './thread-url'

const base = { repoOwner: 'acme', repoName: 'my-repo' }

describe('buildThreadUrl', () => {
  it('returns htmlUrl when present', () => {
    expect(
      buildThreadUrl({
        ...base,
        htmlUrl: 'https://github.com/acme/my-repo/issues/7',
        subjectUrl: 'https://api.github.com/repos/acme/my-repo/issues/7',
      }),
    ).toBe('https://github.com/acme/my-repo/issues/7')
  })

  it('converts an issue subjectUrl to a browser URL', () => {
    expect(
      buildThreadUrl({
        ...base,
        htmlUrl: null,
        subjectUrl: 'https://api.github.com/repos/acme/my-repo/issues/42',
      }),
    ).toBe('https://github.com/acme/my-repo/issues/42')
  })

  it('converts a pull request subjectUrl to a browser URL (pulls → pull)', () => {
    expect(
      buildThreadUrl({
        ...base,
        htmlUrl: null,
        subjectUrl: 'https://api.github.com/repos/acme/my-repo/pulls/99',
      }),
    ).toBe('https://github.com/acme/my-repo/pull/99')
  })

  it('falls back to the repo page when both urls are null', () => {
    expect(
      buildThreadUrl({
        ...base,
        htmlUrl: null,
        subjectUrl: null,
      }),
    ).toBe('https://github.com/acme/my-repo')
  })
})
