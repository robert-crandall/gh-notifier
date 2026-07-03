// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { McpServerSummary, Resource } from '@shared/ipc-channels'
import { McpServersSection, ConnectResourceDialog } from './McpTools'

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  ;(globalThis as unknown as { window: Window }).window.electron = {
    ipc: { invoke },
  } as unknown as Window['electron']
})

const summary = (over: Partial<McpServerSummary> = {}): McpServerSummary => ({
  id: 'srv-1',
  projectId: 1,
  label: 'Datadog prod',
  command: 'datadog-mcp',
  args: ['--stdio'],
  envKeys: ['DD_API_KEY'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const resource = (over: Partial<Resource> = {}): Resource =>
  ({
    id: 7,
    projectId: 1,
    title: 'Checkout latency',
    kind: 'metric_query',
    source: 'datadog',
    service: 'checkout',
    env: 'prod',
    tags: {},
    url: null,
    description: '',
    aliases: [],
    provenance: 'manual',
    confidence: 0.5,
    lastUsed: null,
    lastVerified: null,
    failureCount: 0,
    suspect: false,
    pinnedGroup: null,
    mcpServer: null,
    toolName: null,
    toolArgs: null,
    externalRef: null,
    validationState: 'unverified',
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as Resource

describe('McpServersSection', () => {
  it('renders a server summary with env KEY names but no secret values', () => {
    render(<McpServersSection projectId={1} servers={[summary()]} showUndo={vi.fn()} />)
    expect(screen.getByText('Datadog prod')).toBeTruthy()
    expect(screen.getByText('datadog-mcp')).toBeTruthy()
    // The summary carries no values, so nothing secret can render.
    expect(screen.queryByDisplayValue('DD_API_KEY')).toBeNull()
  })

  it('creates a server, sending the env value exactly once', async () => {
    invoke.mockResolvedValue(summary())
    render(<McpServersSection projectId={1} servers={[]} showUndo={vi.fn()} />)
    fireEvent.click(screen.getByText('Add'))
    fireEvent.change(screen.getByPlaceholderText('Datadog (prod)'), { target: { value: 'DD' } })
    fireEvent.change(screen.getByPlaceholderText('datadog-mcp'), { target: { value: 'dd-mcp' } })
    fireEvent.click(screen.getByText('Add variable'))
    fireEvent.change(screen.getByPlaceholderText('DD_API_KEY'), { target: { value: 'DD_KEY' } })
    fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: 'sekret' } })
    fireEvent.click(screen.getByText('Add server'))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('resources:mcp-create', 1, {
        label: 'DD',
        config: { command: 'dd-mcp', args: [], env: { DD_KEY: 'sekret' } },
      })
    )
  })

  it('edits a server via envDelete, never prefilling the stored secret', async () => {
    invoke.mockResolvedValue(summary())
    render(<McpServersSection projectId={1} servers={[summary()]} showUndo={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Edit server'))
    // The existing env key is a chip (no value input) — the secret is never rendered.
    expect(screen.queryByDisplayValue('DD_API_KEY')).toBeNull()
    fireEvent.click(screen.getByLabelText('Remove DD_API_KEY'))
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('resources:mcp-update', 1, 'srv-1', {
        label: 'Datadog prod',
        command: 'datadog-mcp',
        args: ['--stdio'],
        envSet: {},
        envDelete: ['DD_API_KEY'],
      })
    )
  })

  it('treats re-entering a removed key as a replacement (no overlap conflict)', async () => {
    invoke.mockResolvedValue(summary())
    render(<McpServersSection projectId={1} servers={[summary()]} showUndo={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Edit server'))
    fireEvent.click(screen.getByLabelText('Remove DD_API_KEY'))
    // Re-enter the same key with a new value.
    fireEvent.click(screen.getByText('Add variable'))
    fireEvent.change(screen.getByPlaceholderText('DD_API_KEY'), { target: { value: 'DD_API_KEY' } })
    fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: 'rotated' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('resources:mcp-update', 1, 'srv-1', {
        label: 'Datadog prod',
        command: 'datadog-mcp',
        args: ['--stdio'],
        envSet: { DD_API_KEY: 'rotated' },
        envDelete: [],
      })
    )
  })

  it('deletes with an undo that restores the server', async () => {
    const showUndo = vi.fn()
    invoke.mockResolvedValue(undefined)
    render(<McpServersSection projectId={1} servers={[summary()]} showUndo={showUndo} />)
    fireEvent.click(screen.getByLabelText('Disconnect server'))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('resources:mcp-delete', 1, 'srv-1'))
    expect(showUndo).toHaveBeenCalled()
    // Invoking the undo restores it.
    const onUndo = showUndo.mock.calls[0][1] as () => void
    onUndo()
    expect(invoke).toHaveBeenCalledWith('resources:mcp-restore', 1, 'srv-1')
  })

  it('checks a server and shows an honest "starts · N tools" line', async () => {
    invoke.mockResolvedValue({ ok: true, tools: [{ name: 'query' }, { name: 'search' }] })
    render(<McpServersSection projectId={1} servers={[summary()]} showUndo={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Check the server starts + list its tools'))
    await waitFor(() => expect(screen.getByText('Server starts · 2 tools found')).toBeTruthy())
  })
})

describe('ConnectResourceDialog', () => {
  it('discovers tools then connects with parsed JSON args', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'resources:mcp-list-tools') return Promise.resolve({ ok: true, tools: [{ name: 'query', description: 'run a query' }] })
      return Promise.resolve(resource())
    })
    render(<ConnectResourceDialog projectId={1} resource={resource()} servers={[summary()]} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('Discover tools'))
    await waitFor(() => expect(screen.getByRole('option', { name: 'query' })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Tool'), { target: { value: 'query' } })
    expect(screen.getByText('run a query')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Tool args'), { target: { value: '{"metric":"p99"}' } })
    fireEvent.click(screen.getByText('Connect'))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('resources:mcp-connect', 7, {
        serverId: 'srv-1',
        toolName: 'query',
        toolArgs: { metric: 'p99' },
      })
    )
  })

  it('rejects invalid JSON args before calling connect', async () => {
    render(<ConnectResourceDialog projectId={1} resource={resource({ toolName: 'query', mcpServer: 'srv-1' })} servers={[summary()]} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Tool args'), { target: { value: 'not json' } })
    fireEvent.click(screen.getByText('Connect'))
    await waitFor(() => expect(screen.getByText('Tool args must be valid JSON')).toBeTruthy())
    expect(invoke).not.toHaveBeenCalledWith('resources:mcp-connect', expect.anything(), expect.anything())
  })
})
