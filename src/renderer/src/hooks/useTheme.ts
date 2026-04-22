import { useState, useEffect, useCallback } from 'react'

export const THEMES = [
  { id: 'light',     label: 'Light',     dark: false },
  { id: 'dark',      label: 'Dark',      dark: true  },
  { id: 'nord',      label: 'Nord',      dark: false },
  { id: 'dracula',   label: 'Dracula',   dark: true  },
  { id: 'night',     label: 'Night',     dark: true  },
  { id: 'dim',       label: 'Dim',       dark: true  },
  { id: 'corporate', label: 'Corporate', dark: false },
  { id: 'lemonade',  label: 'Lemonade',  dark: false },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

const STORAGE_KEY = 'gh-projects-theme'

function getSystemTheme(): ThemeId {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readStoredTheme(): ThemeId | null {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && THEMES.some((t) => t.id === stored)) {
    return stored as ThemeId
  }
  return null
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(
    () => readStoredTheme() ?? getSystemTheme()
  )

  // Apply the theme attribute whenever it changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const setTheme = useCallback((next: ThemeId) => {
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
  }, [])

  return { theme, setTheme, themes: THEMES }
}
