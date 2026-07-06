// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LinkifiedText } from './LinkifiedText'

const openExternal = vi.fn(() => Promise.resolve())

beforeEach(() => {
  openExternal.mockClear()
  ;(globalThis as unknown as { window: Window }).window.electron = {
    openExternal,
  } as unknown as Window['electron']
})

describe('LinkifiedText', () => {
  it('renders plain text with no link button', () => {
    render(<LinkifiedText text="no links here" />)
    expect(screen.getByText('no links here')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders a URL as a button and opens it on click', () => {
    render(<LinkifiedText text="see https://example.com/x now" />)
    const link = screen.getByRole('button', { name: 'https://example.com/x' })
    fireEvent.click(link)
    expect(openExternal).toHaveBeenCalledWith('https://example.com/x')
  })

  it('keeps a click on the link from bubbling to a clickable ancestor', () => {
    const onParentClick = vi.fn()
    render(
      <div onClick={onParentClick}>
        <LinkifiedText text="open https://example.com" />
      </div>
    )
    fireEvent.click(screen.getByRole('button', { name: 'https://example.com' }))
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('does not linkify a non-http(s) scheme', () => {
    render(<LinkifiedText text="run javascript:alert(1)" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
