// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTheme } from './useTheme'

// ── Helpers ───────────────────────────────────────────────────────────────────

function stubMatchMedia(prefersDark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: prefersDark && query.includes('dark'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  stubMatchMedia(false)
})

// ── useTheme ──────────────────────────────────────────────────────────────────

describe('useTheme', () => {
  it('reads a valid saved theme from localStorage on mount', () => {
    localStorage.setItem('gh-projects-theme', 'dracula')
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dracula')
  })

  it('applies the theme as the data-theme attribute on mount', () => {
    localStorage.setItem('gh-projects-theme', 'nord')
    renderHook(() => useTheme())
    expect(document.documentElement.getAttribute('data-theme')).toBe('nord')
  })

  it('falls back to "dark" when no saved theme and system prefers dark', () => {
    stubMatchMedia(true)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
  })

  it('falls back to "light" when no saved theme and system prefers light', () => {
    stubMatchMedia(false)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
  })

  it('setTheme updates the theme state', () => {
    const { result } = renderHook(() => useTheme())
    act(() => {
      result.current.setTheme('dracula')
    })
    expect(result.current.theme).toBe('dracula')
  })

  it('setTheme persists the chosen theme to localStorage', () => {
    const { result } = renderHook(() => useTheme())
    act(() => {
      result.current.setTheme('night')
    })
    expect(localStorage.getItem('gh-projects-theme')).toBe('night')
  })

  it('setTheme updates the data-theme attribute', () => {
    const { result } = renderHook(() => useTheme())
    act(() => {
      result.current.setTheme('corporate')
    })
    expect(document.documentElement.getAttribute('data-theme')).toBe('corporate')
  })

  it('ignores an invalid value stored in localStorage and falls back to the system theme', () => {
    localStorage.setItem('gh-projects-theme', 'not-a-real-theme')
    stubMatchMedia(false)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
  })
})
