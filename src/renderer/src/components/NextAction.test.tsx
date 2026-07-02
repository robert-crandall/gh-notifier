// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NextAction } from './NextAction'

describe('NextAction', () => {
  it('shows the current next action', () => {
    render(<NextAction value="Wire the retry backoff" onSave={vi.fn()} onDone={vi.fn()} />)
    expect(screen.getByText('Wire the retry backoff')).toBeTruthy()
  })

  it('shows a placeholder when empty and disables Done', () => {
    render(<NextAction value="" onSave={vi.fn()} onDone={vi.fn()} />)
    expect(screen.getByText('Set your next action…')).toBeTruthy()
    expect(screen.getByText('Done').closest('button')?.hasAttribute('disabled')).toBe(true)
  })

  it('saves an edited value on Enter', () => {
    const onSave = vi.fn()
    render(<NextAction value="old" onSave={onSave} onDone={vi.fn()} />)
    fireEvent.click(screen.getByText('old'))
    const input = screen.getByPlaceholderText(/one next thing/)
    fireEvent.change(input, { target: { value: 'new action' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith('new action')
  })

  it('calls onDone when Done is clicked', () => {
    const onDone = vi.fn()
    render(<NextAction value="something" onSave={vi.fn()} onDone={onDone} />)
    fireEvent.click(screen.getByText('Done'))
    expect(onDone).toHaveBeenCalledOnce()
  })
})
