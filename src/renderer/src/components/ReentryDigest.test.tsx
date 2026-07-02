// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReentryDigest as ReentryDigestType } from '@shared/ipc-channels'
import { ReentryDigest } from './ReentryDigest'

const openExternal = vi.fn()

beforeEach(() => {
  openExternal.mockReset()
  ;(globalThis as unknown as { window: Window }).window.electron = {
    openExternal,
  } as unknown as Window['electron']
})

const digest: ReentryDigestType = {
  projectId: 1,
  asOf: '2026-07-02T12:00:00.000Z',
  items: [
    { id: 'a', kind: 'agent-pr-ready', tone: 'success', text: 'Copilot opened a PR — ready to review.', href: 'https://x/pull/9', count: null },
    { id: 'b', kind: 'notifications-grouped', tone: 'neutral', text: '2 notifications routed here.', href: null, count: 2 },
  ],
}

describe('ReentryDigest', () => {
  it('renders the digest bullets', () => {
    render(<ReentryDigest digest={digest} onDismiss={vi.fn()} />)
    expect(screen.getByText('Since you were here')).toBeTruthy()
    expect(screen.getByText(/ready to review/)).toBeTruthy()
    expect(screen.getByText('2 notifications routed here.')).toBeTruthy()
  })

  it('calls onDismiss when the close button is clicked', () => {
    const onDismiss = vi.fn()
    render(<ReentryDigest digest={digest} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByLabelText('Dismiss digest'))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('opens the linked item externally', () => {
    render(<ReentryDigest digest={digest} onDismiss={vi.fn()} />)
    fireEvent.click(screen.getByText(/ready to review/))
    expect(openExternal).toHaveBeenCalledWith('https://x/pull/9')
  })

  it('renders nothing when there are no items', () => {
    const { container } = render(<ReentryDigest digest={{ ...digest, items: [] }} onDismiss={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})
