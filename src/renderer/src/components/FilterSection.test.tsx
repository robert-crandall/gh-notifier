// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { FilterSection } from './FilterSection'
import type { NotificationFilter } from '@shared/ipc-channels'

const makeFilter = (overrides: Partial<NotificationFilter> = {}): NotificationFilter => ({
  id: 1,
  dimension: 'author',
  value: 'dependabot',
  scope: 'global',
  scopeOwner: null,
  scopeRepo: null,
  createdAt: '2024-01-01T00:00:00Z',
  ...overrides,
})

beforeEach(() => {
  ;(window as unknown as Record<string, unknown>).electron = {
    ipc: { invoke: vi.fn() },
    openExternal: vi.fn(),
    onNotificationsUpdated: vi.fn(() => vi.fn()),
  }
})

describe('FilterSection', () => {
  describe('initial render', () => {
    it('lists active filters and shows the Add filter button', () => {
      const filter = makeFilter()
      render(<FilterSection filters={[filter]} onAdd={vi.fn()} onRemove={vi.fn()} />)
      expect(screen.getByText(/author: dependabot/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /\+ add filter/i })).toBeInTheDocument()
    })
  })

  describe('dimension value inputs', () => {
    async function openFormAndSelectDimension(dimension: string) {
      render(<FilterSection filters={[]} onAdd={vi.fn()} onRemove={vi.fn()} />)
      await userEvent.click(screen.getByRole('button', { name: /\+ add filter/i }))
      const [dimensionSelect] = screen.getAllByRole('combobox')
      await userEvent.selectOptions(dimensionSelect, dimension)
    }

    it('shows a text input for the author dimension', async () => {
      await openFormAndSelectDimension('author')
      expect(screen.getByPlaceholderText(/filter by author/i)).toBeInTheDocument()
    })

    it('shows a text input for the org dimension', async () => {
      await openFormAndSelectDimension('org')
      expect(screen.getByPlaceholderText(/filter by org/i)).toBeInTheDocument()
    })

    it('shows a text input for the repo dimension', async () => {
      await openFormAndSelectDimension('repo')
      expect(screen.getByPlaceholderText(/filter by repo/i)).toBeInTheDocument()
    })

    it('shows a text input for the reason dimension', async () => {
      await openFormAndSelectDimension('reason')
      // reason uses a select dropdown per DIMENSION_OPTIONS
      const comboboxes = screen.getAllByRole('combobox')
      // reason is in DIMENSION_OPTIONS so it renders a select
      expect(within(comboboxes[1]).getByRole('option', { name: 'assign' })).toBeInTheDocument()
    })

    it('shows a select dropdown with valid states for the state dimension', async () => {
      await openFormAndSelectDimension('state')
      const comboboxes = screen.getAllByRole('combobox')
      const valueSelect = comboboxes[1]
      expect(within(valueSelect).getByRole('option', { name: 'open' })).toBeInTheDocument()
      expect(within(valueSelect).getByRole('option', { name: 'closed' })).toBeInTheDocument()
      expect(within(valueSelect).getByRole('option', { name: 'merged' })).toBeInTheDocument()
    })

    it('shows a select dropdown with notification types for the type dimension', async () => {
      render(<FilterSection filters={[]} onAdd={vi.fn()} onRemove={vi.fn()} />)
      await userEvent.click(screen.getByRole('button', { name: /\+ add filter/i }))
      // type is the default dimension
      const comboboxes = screen.getAllByRole('combobox')
      const valueSelect = comboboxes[1]
      expect(within(valueSelect).getByRole('option', { name: 'PullRequest' })).toBeInTheDocument()
      expect(within(valueSelect).getByRole('option', { name: 'Issue' })).toBeInTheDocument()
    })
  })

  describe('repo scope', () => {
    it('shows owner and repo name fields when repo scope is selected', async () => {
      render(<FilterSection filters={[]} onAdd={vi.fn()} onRemove={vi.fn()} />)
      await userEvent.click(screen.getByRole('button', { name: /\+ add filter/i }))
      // type is default; the scope checkbox is only shown for type dimension
      await userEvent.click(screen.getByRole('checkbox'))
      expect(screen.getByPlaceholderText('owner')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('repo')).toBeInTheDocument()
    })

    it('blocks submit and shows error when owner or repo is blank', async () => {
      const onAdd = vi.fn()
      render(<FilterSection filters={[]} onAdd={onAdd} onRemove={vi.fn()} />)
      await userEvent.click(screen.getByRole('button', { name: /\+ add filter/i }))
      await userEvent.click(screen.getByRole('checkbox'))
      // Leave owner/repo blank, submit the form
      await userEvent.click(screen.getByRole('button', { name: /^add filter$/i }))
      expect(onAdd).not.toHaveBeenCalled()
      expect(screen.getByText(/repository owner and name are required/i)).toBeInTheDocument()
    })
  })

  describe('form submission', () => {
    it('calls onAdd with correct args for a global type filter', async () => {
      const onAdd = vi.fn().mockResolvedValue(undefined)
      render(<FilterSection filters={[]} onAdd={onAdd} onRemove={vi.fn()} />)
      await userEvent.click(screen.getByRole('button', { name: /\+ add filter/i }))
      // Default: type=PullRequest, scope=global
      await userEvent.click(screen.getByRole('button', { name: /^add filter$/i }))
      expect(onAdd).toHaveBeenCalledWith('type', 'PullRequest', 'global', undefined, undefined)
    })

    it('calls onAdd with repo scope fields when repo scope is set', async () => {
      const onAdd = vi.fn().mockResolvedValue(undefined)
      render(<FilterSection filters={[]} onAdd={onAdd} onRemove={vi.fn()} />)
      await userEvent.click(screen.getByRole('button', { name: /\+ add filter/i }))
      await userEvent.click(screen.getByRole('checkbox'))
      await userEvent.type(screen.getByPlaceholderText('owner'), 'acme')
      await userEvent.type(screen.getByPlaceholderText('repo'), 'widget')
      await userEvent.click(screen.getByRole('button', { name: /^add filter$/i }))
      expect(onAdd).toHaveBeenCalledWith('type', 'PullRequest', 'repo', 'acme', 'widget')
    })
  })

  describe('filter chip removal', () => {
    it('calls onRemove with the filter id when × is clicked', async () => {
      const onRemove = vi.fn().mockResolvedValue(undefined)
      const filter = makeFilter({ id: 42 })
      render(<FilterSection filters={[filter]} onAdd={vi.fn()} onRemove={onRemove} />)
      await userEvent.click(screen.getByRole('button', { name: /remove filter/i }))
      expect(onRemove).toHaveBeenCalledWith(42)
    })
  })
})
