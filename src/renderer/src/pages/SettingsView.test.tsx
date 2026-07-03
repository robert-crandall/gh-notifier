// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsView } from './SettingsView'
import type { UseThemeResult } from '../hooks/useTheme'

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  invoke.mockImplementation((channel: string) => {
    switch (channel) {
      case 'auth:status':
        return Promise.resolve({ authenticated: false })
      case 'settings:get-sync-interval':
        return Promise.resolve(15)
      case 'settings:get-max-sync-days':
        return Promise.resolve(7)
      case 'settings:get-app-delegate-enabled':
        return Promise.resolve(false)
      case 'settings:get-repos-root':
        return Promise.resolve('~/repos')
      default:
        return Promise.resolve(undefined)
    }
  })
  ;(globalThis as unknown as { window: Window }).window.electron = {
    ipc: { invoke },
    openExternal: vi.fn(() => Promise.resolve()),
  } as unknown as Window['electron']
})

function theme(overrides: Partial<UseThemeResult> = {}): UseThemeResult {
  return {
    colorMode: 'system',
    resolvedColorMode: 'dark',
    setColorMode: vi.fn(),
    accent: 'slate',
    setAccent: vi.fn(),
    density: 'compact',
    setDensity: vi.fn(),
    ...overrides,
  }
}

describe('SettingsView appearance', () => {
  it('offers all five color modes including dim and high contrast', async () => {
    render(<SettingsView theme={theme()} onClose={vi.fn()} onOpenRules={vi.fn()} />)
    const select = (await screen.findByLabelText('Color mode')) as HTMLSelectElement
    const options = Array.from(select.options).map((o) => o.textContent)
    expect(options).toEqual(['System', 'Light', 'Dark', 'Dim', 'High contrast'])
  })

  it('applies a selected color mode via the theme hook', async () => {
    const setColorMode = vi.fn()
    render(<SettingsView theme={theme({ setColorMode })} onClose={vi.fn()} onOpenRules={vi.fn()} />)
    const select = await screen.findByLabelText('Color mode')
    fireEvent.change(select, { target: { value: 'high-contrast' } })
    await waitFor(() => expect(setColorMode).toHaveBeenCalledWith('high-contrast'))
  })

  it('opens the notification rules surface', async () => {
    const onOpenRules = vi.fn()
    render(<SettingsView theme={theme()} onClose={vi.fn()} onOpenRules={onOpenRules} />)
    fireEvent.click(await screen.findByText('Notification rules'))
    expect(onOpenRules).toHaveBeenCalled()
  })

  it('toggles the Copilot app-delegate flag and persists it', async () => {
    render(<SettingsView theme={theme()} onClose={vi.fn()} onOpenRules={vi.fn()} />)
    const toggle = (await screen.findByText('Delegate to the Copilot app')).closest('label')?.querySelector('input')
    expect(toggle).toBeTruthy()
    expect((toggle as HTMLInputElement).checked).toBe(false)
    fireEvent.click(toggle as HTMLInputElement)
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('settings:set-app-delegate-enabled', true)
    )
  })

  it('saves the repos root', async () => {
    render(<SettingsView theme={theme()} onClose={vi.fn()} onOpenRules={vi.fn()} />)
    const input = (await screen.findByPlaceholderText('~/repos')) as HTMLInputElement
    fireEvent.change(input, { target: { value: '~/code' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('settings:set-repos-root', '~/code'))
  })

  it('normalizes a cleared repos root to the default and reflects it in the input', async () => {
    render(<SettingsView theme={theme()} onClose={vi.fn()} onOpenRules={vi.fn()} />)
    const input = (await screen.findByPlaceholderText('~/repos')) as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('settings:set-repos-root', '~/repos'))
    expect(input.value).toBe('~/repos')
  })
})
