// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { AuthPanel } from './AuthPanel'

beforeEach(() => {
  ;(window as unknown as Record<string, unknown>).electron = {
    ipc: { invoke: vi.fn() },
    openExternal: vi.fn(),
    onNotificationsUpdated: vi.fn(() => vi.fn()),
  }
})

describe('AuthPanel', () => {
  describe('unauthenticated state', () => {
    it('renders PAT input and Connect button', () => {
      render(
        <AuthPanel
          status={{ authenticated: false }}
          isLoading={false}
          error={null}
          onSavePat={vi.fn()}
          onLogout={vi.fn()}
        />
      )
      expect(screen.getByPlaceholderText('ghp_…')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
    })

    it('Connect button is disabled and onSavePat is not called when PAT is empty', async () => {
      const onSavePat = vi.fn()
      render(
        <AuthPanel
          status={{ authenticated: false }}
          isLoading={false}
          error={null}
          onSavePat={onSavePat}
          onLogout={vi.fn()}
        />
      )
      const button = screen.getByRole('button', { name: 'Connect' })
      expect(button).toBeDisabled()
      await userEvent.click(button)
      expect(onSavePat).not.toHaveBeenCalled()
    })

    it('calls onSavePat with the token when Connect is clicked with a non-empty value', async () => {
      const onSavePat = vi.fn()
      render(
        <AuthPanel
          status={{ authenticated: false }}
          isLoading={false}
          error={null}
          onSavePat={onSavePat}
          onLogout={vi.fn()}
        />
      )
      await userEvent.type(screen.getByPlaceholderText('ghp_…'), 'ghp_abc123')
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
      expect(onSavePat).toHaveBeenCalledWith('ghp_abc123')
    })
  })

  describe('authenticated state', () => {
    it('renders avatar, login name, and Sign out button', () => {
      render(
        <AuthPanel
          status={{ authenticated: true, login: 'octocat', avatarUrl: 'https://example.com/avatar.png' }}
          isLoading={false}
          error={null}
          onSavePat={vi.fn()}
          onLogout={vi.fn()}
        />
      )
      expect(screen.getByRole('img', { name: 'octocat' })).toBeInTheDocument()
      expect(screen.getByText('@octocat')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    })

    it('does not render the PAT form when authenticated', () => {
      render(
        <AuthPanel
          status={{ authenticated: true, login: 'octocat', avatarUrl: 'https://example.com/avatar.png' }}
          isLoading={false}
          error={null}
          onSavePat={vi.fn()}
          onLogout={vi.fn()}
        />
      )
      expect(screen.queryByPlaceholderText('ghp_…')).not.toBeInTheDocument()
    })

    it('calls onLogout when Sign out is clicked', async () => {
      const onLogout = vi.fn()
      render(
        <AuthPanel
          status={{ authenticated: true, login: 'octocat', avatarUrl: 'https://example.com/avatar.png' }}
          isLoading={false}
          error={null}
          onSavePat={vi.fn()}
          onLogout={onLogout}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
      expect(onLogout).toHaveBeenCalledOnce()
    })
  })
})
