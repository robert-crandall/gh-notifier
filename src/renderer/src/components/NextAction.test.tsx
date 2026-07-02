// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NextAction } from './NextAction'

describe('NextAction', () => {
  it('shows the current next action', () => {
    render(<NextAction value="Wire the retry backoff" onSave={vi.fn()} onDone={vi.fn()} onDelegate={vi.fn()} />)
    expect(screen.getByText('Wire the retry backoff')).toBeTruthy()
  })

  it('shows a placeholder when empty and disables Done', () => {
    render(<NextAction value="" onSave={vi.fn()} onDone={vi.fn()} onDelegate={vi.fn()} />)
    expect(screen.getByText('Set your next action…')).toBeTruthy()
    expect(screen.getByText('Done').closest('button')?.hasAttribute('disabled')).toBe(true)
  })

  it('saves an edited value on Enter', () => {
    const onSave = vi.fn()
    render(<NextAction value="old" onSave={onSave} onDone={vi.fn()} onDelegate={vi.fn()} />)
    fireEvent.click(screen.getByText('old'))
    const input = screen.getByPlaceholderText(/one next thing/)
    fireEvent.change(input, { target: { value: 'new action' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith('new action')
  })

  it('calls onDone when Done is clicked', () => {
    const onDone = vi.fn()
    render(<NextAction value="something" onSave={vi.fn()} onDone={onDone} onDelegate={vi.fn()} />)
    fireEvent.click(screen.getByText('Done'))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('delegates the current value and disables Delegate when empty', () => {
    const onDelegate = vi.fn()
    const { rerender } = render(<NextAction value="" onSave={vi.fn()} onDone={vi.fn()} onDelegate={onDelegate} />)
    expect(screen.getByText('Delegate').closest('button')?.hasAttribute('disabled')).toBe(true)

    rerender(<NextAction value="Ship it" onSave={vi.fn()} onDone={vi.fn()} onDelegate={onDelegate} />)
    fireEvent.click(screen.getByText('Delegate'))
    expect(onDelegate).toHaveBeenCalledWith('Ship it')
  })
})
