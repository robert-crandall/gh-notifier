import { useCallback, useEffect, useState } from 'react'

export type ColorMode = 'light' | 'dark' | 'dim' | 'high-contrast' | 'system'
export type ResolvedColorMode = 'light' | 'dark' | 'dim' | 'high-contrast'
export type Accent = 'slate' | 'blue' | 'green' | 'violet'
export type Density = 'compact' | 'comfortable'

export const ACCENTS: Accent[] = ['slate', 'blue', 'green', 'violet']
export const COLOR_MODES: ColorMode[] = ['system', 'light', 'dark', 'dim', 'high-contrast']
export const DENSITIES: Density[] = ['compact', 'comfortable']

/** Human-readable label for a color mode (e.g. 'high-contrast' → 'High contrast'). */
export const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  dim: 'Dim',
  'high-contrast': 'High contrast',
}

const COLOR_MODE_KEY = 'focus-color-mode'
const ACCENT_KEY = 'focus-accent'
const DENSITY_KEY = 'focus-density'

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const stored = localStorage.getItem(key)
  return stored && (allowed as readonly string[]).includes(stored) ? (stored as T) : fallback
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveColorMode(mode: ColorMode): ResolvedColorMode {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return mode
}

export interface UseThemeResult {
  colorMode: ColorMode
  resolvedColorMode: ResolvedColorMode
  setColorMode: (mode: ColorMode) => void
  accent: Accent
  setAccent: (accent: Accent) => void
  density: Density
  setDensity: (density: Density) => void
}

export function useTheme(): UseThemeResult {
  const [colorMode, setColorModeState] = useState<ColorMode>(() =>
    readStored<ColorMode>(COLOR_MODE_KEY, COLOR_MODES, 'system')
  )
  const [accent, setAccentState] = useState<Accent>(() => readStored<Accent>(ACCENT_KEY, ACCENTS, 'slate'))
  const [density, setDensityState] = useState<Density>(() =>
    readStored<Density>(DENSITY_KEY, DENSITIES, 'compact')
  )
  const [resolvedColorMode, setResolvedColorMode] = useState<ResolvedColorMode>(() => resolveColorMode(colorMode))

  // Keep the resolved mode in sync, and follow the system preference while in 'system'.
  useEffect(() => {
    setResolvedColorMode(resolveColorMode(colorMode))
    if (colorMode !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => setResolvedColorMode(systemPrefersDark() ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [colorMode])

  // Apply the three data-attributes to <html>.
  useEffect(() => {
    document.documentElement.setAttribute('data-color-mode', resolvedColorMode)
  }, [resolvedColorMode])

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent)
  }, [accent])

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density)
  }, [density])

  const setColorMode = useCallback((mode: ColorMode): void => {
    localStorage.setItem(COLOR_MODE_KEY, mode)
    setColorModeState(mode)
  }, [])

  const setAccent = useCallback((next: Accent): void => {
    localStorage.setItem(ACCENT_KEY, next)
    setAccentState(next)
  }, [])

  const setDensity = useCallback((next: Density): void => {
    localStorage.setItem(DENSITY_KEY, next)
    setDensityState(next)
  }, [])

  return { colorMode, resolvedColorMode, setColorMode, accent, setAccent, density, setDensity }
}
