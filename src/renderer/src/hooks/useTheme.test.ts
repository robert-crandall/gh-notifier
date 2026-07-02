// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTheme } from './useTheme'

function stubMatchMedia(prefersDark: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('dark') ? prefersDark : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-color-mode')
  document.documentElement.removeAttribute('data-accent')
  document.documentElement.removeAttribute('data-density')
  stubMatchMedia(false)
})

describe('useTheme', () => {
  it('defaults to system color mode, slate accent, compact density', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.colorMode).toBe('system')
    expect(result.current.accent).toBe('slate')
    expect(result.current.density).toBe('compact')
  })

  it('resolves system mode to light when the system prefers light', () => {
    stubMatchMedia(false)
    const { result } = renderHook(() => useTheme())
    expect(result.current.resolvedColorMode).toBe('light')
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('light')
  })

  it('resolves system mode to dark when the system prefers dark', () => {
    stubMatchMedia(true)
    const { result } = renderHook(() => useTheme())
    expect(result.current.resolvedColorMode).toBe('dark')
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('dark')
  })

  it('reads a stored color mode, accent, and density on mount', () => {
    localStorage.setItem('focus-color-mode', 'dark')
    localStorage.setItem('focus-accent', 'violet')
    localStorage.setItem('focus-density', 'comfortable')
    const { result } = renderHook(() => useTheme())
    expect(result.current.colorMode).toBe('dark')
    expect(result.current.accent).toBe('violet')
    expect(result.current.density).toBe('comfortable')
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('dark')
    expect(document.documentElement.getAttribute('data-accent')).toBe('violet')
    expect(document.documentElement.getAttribute('data-density')).toBe('comfortable')
  })

  it('ignores invalid stored values and falls back to defaults', () => {
    localStorage.setItem('focus-color-mode', 'chartreuse')
    localStorage.setItem('focus-accent', 'neon')
    const { result } = renderHook(() => useTheme())
    expect(result.current.colorMode).toBe('system')
    expect(result.current.accent).toBe('slate')
  })

  it('setColorMode persists and updates the data-color-mode attribute', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setColorMode('light'))
    expect(result.current.colorMode).toBe('light')
    expect(localStorage.getItem('focus-color-mode')).toBe('light')
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('light')
  })

  it('setAccent persists and updates the data-accent attribute', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setAccent('blue'))
    expect(result.current.accent).toBe('blue')
    expect(localStorage.getItem('focus-accent')).toBe('blue')
    expect(document.documentElement.getAttribute('data-accent')).toBe('blue')
  })

  it('setDensity persists and updates the data-density attribute', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setDensity('comfortable'))
    expect(result.current.density).toBe('comfortable')
    expect(localStorage.getItem('focus-density')).toBe('comfortable')
    expect(document.documentElement.getAttribute('data-density')).toBe('comfortable')
  })
})
