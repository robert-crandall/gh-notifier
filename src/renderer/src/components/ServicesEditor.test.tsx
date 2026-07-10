// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ServicesEditor } from './ServicesEditor'

function renderEditor(services: string[], busy = false): { onAdd: ReturnType<typeof vi.fn>; onRemove: ReturnType<typeof vi.fn> } {
  const onAdd = vi.fn()
  const onRemove = vi.fn()
  render(<ServicesEditor services={services} onAdd={onAdd} onRemove={onRemove} busy={busy} />)
  return { onAdd, onRemove }
}

function typeService(value: string): HTMLInputElement {
  const input = screen.getByLabelText('Add a service') as HTMLInputElement
  fireEvent.change(input, { target: { value } })
  return input
}

describe('ServicesEditor', () => {
  it('adds a valid service with its normalized key and clears the input', () => {
    const { onAdd } = renderEditor([])
    const input = typeService('usersd')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith('usersd')
    expect(input.value).toBe('')
  })

  it('normalizes case/whitespace: previews and adds the normalized key', () => {
    const { onAdd } = renderEditor([])
    typeService('  UsersD  ')
    expect(screen.getByText('usersd')).toBeTruthy()
    fireEvent.keyDown(screen.getByLabelText('Add a service'), { key: 'Enter' })
    expect(onAdd).toHaveBeenCalledWith('usersd')
  })

  it('rejects an unsafe name with the returned reason and does not add', () => {
    const { onAdd } = renderEditor([])
    typeService('../etc')
    expect(screen.getByText(/must not contain path separators/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(screen.getByLabelText('Add a service'), { key: 'Enter' })
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('dedupes by normalized key: an existing service (any case) blocks the add', () => {
    const { onAdd } = renderEditor(['api'])
    typeService('API')
    expect(screen.getByText(/already on this project/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(screen.getByLabelText('Add a service'), { key: 'Enter' })
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('removes a service by its normalized key', () => {
    const { onRemove } = renderEditor(['payments-api'])
    fireEvent.click(screen.getByLabelText('Remove payments-api'))
    expect(onRemove).toHaveBeenCalledWith('payments-api')
  })

  it('collapses duplicate raw entries to one row (deduped by normalized key)', () => {
    renderEditor(['API', 'api'])
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('states that removing keeps the runbook file on disk', () => {
    renderEditor(['api'])
    expect(screen.getByText(/runbook file on disk is kept/i)).toBeTruthy()
  })

  it('disables the controls while a mutation is in flight', () => {
    renderEditor(['api'], true)
    expect((screen.getByLabelText('Add a service') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Remove api') as HTMLButtonElement).disabled).toBe(true)
  })
})
