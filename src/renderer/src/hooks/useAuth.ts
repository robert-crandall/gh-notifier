import { useState, useEffect, useCallback } from 'react'
import type { AuthStatus } from '@shared/ipc-channels'

interface AuthState {
  status: AuthStatus | null
  isLoading: boolean
  error: string | null
}

interface UseAuthResult extends AuthState {
  savePat: (token: string) => Promise<void>
  logout: () => Promise<void>
}

export function useAuth(): UseAuthResult {
  const [state, setState] = useState<AuthState>({
    status: null,
    isLoading: true,
    error: null
  })

  useEffect(() => {
    window.electron.ipc
      .invoke('auth:status')
      .then((status) => {
        setState((s) => ({ ...s, status, isLoading: false }))
      })
      .catch((err: unknown) => {
        setState((s) => ({ ...s, error: String(err), isLoading: false }))
      })
  }, [])

  const savePat = useCallback(async (token: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }))
    try {
      const status = await window.electron.ipc.invoke('auth:save-token', token)
      setState({ status, isLoading: false, error: null })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setState((s) => ({ ...s, isLoading: false, error: message }))
    }
  }, [])

  const logout = useCallback(async () => {
    await window.electron.ipc.invoke('auth:logout')
    setState({ status: { authenticated: false }, isLoading: false, error: null })
  }, [])

  return { ...state, savePat, logout }
}
