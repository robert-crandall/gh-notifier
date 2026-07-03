import { useState } from 'react'
import { Plus, Trash2, X, Zap, Check, RefreshCw, Pencil } from 'lucide-react'
import type { McpServerSummary, McpToolInfo, McpToolsResult, Resource } from '@shared/ipc-channels'
import { Icon } from './Icon'
import { fire } from '../ipc'
import styles from './McpTools.module.css'

/** One command argument per line; trims and drops blanks. */
function parseArgsLines(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Stringify that never throws (server-controlled inputSchema may hold a BigInt etc.). */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

interface EnvRow {
  key: string
  value: string
}

// ── Server add/edit form ──────────────────────────────────────────────────────

/**
 * Add or edit a wired MCP server. Secrets are write-only: on edit, existing env
 * values are NEVER shown (the renderer only receives key names). Existing keys
 * can be removed (envDelete) or replaced by re-entering them (envSet); omitted
 * keys are preserved server-side.
 */
function ServerForm({
  projectId,
  existing,
  onDone,
}: {
  projectId: number
  existing: McpServerSummary | null
  onDone: () => void
}): JSX.Element {
  const [label, setLabel] = useState(existing?.label ?? '')
  const [command, setCommand] = useState(existing?.command ?? '')
  const [argsText, setArgsText] = useState((existing?.args ?? []).join('\n'))
  // Edit: keys the user chose to drop. Create: unused.
  const [removedKeys, setRemovedKeys] = useState<string[]>([])
  // New/replacement secrets, entered once and sent one-way.
  const [envRows, setEnvRows] = useState<EnvRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const isEdit = existing !== null
  const remainingKeys = (existing?.envKeys ?? []).filter((k) => !removedKeys.includes(k))

  const setRow = (i: number, patch: Partial<EnvRow>): void => {
    setEnvRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  const submit = async (): Promise<void> => {
    setError(null)
    setSaving(true)
    try {
      const envEntries = envRows.map((r) => ({ key: r.key.trim(), value: r.value })).filter((r) => r.key.length > 0)
      const envSet = Object.fromEntries(envEntries.map((r) => [r.key, r.value]))
      if (isEdit && existing) {
        // Re-entering a removed key is a REPLACEMENT, not a conflict: drop it from
        // envDelete so it lands in envSet only (main rejects a key in both).
        const setKeys = new Set(Object.keys(envSet))
        const envDelete = removedKeys.filter((k) => !setKeys.has(k))
        await window.electron.ipc.invoke('resources:mcp-update', projectId, existing.id, {
          label: label.trim(),
          command: command.trim(),
          args: parseArgsLines(argsText),
          envSet,
          envDelete,
        })
      } else {
        await window.electron.ipc.invoke('resources:mcp-create', projectId, {
          label: label.trim(),
          config: { command: command.trim(), args: parseArgsLines(argsText), env: envSet },
        })
      }
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the server')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Label</span>
        <input className={styles.input} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Datadog (prod)" autoFocus />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Command</span>
        <input className={styles.input} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="datadog-mcp" />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Arguments (one per line)</span>
        <textarea className={styles.textarea} value={argsText} onChange={(e) => setArgsText(e.target.value)} rows={2} placeholder={'--stdio'} />
      </label>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Environment {isEdit && <span className={styles.hint}>(values hidden — re-enter to replace)</span>}</span>
        {isEdit && remainingKeys.length > 0 && (
          <div className={styles.envChips}>
            {remainingKeys.map((k) => (
              <span key={k} className={styles.envChip}>
                {k} <span className={styles.envSet}>•••• set</span>
                <button type="button" className={styles.chipX} onClick={() => setRemovedKeys((r) => [...r, k])} aria-label={`Remove ${k}`}>
                  <Icon icon={X} size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        {envRows.map((row, i) => (
          <div key={i} className={styles.envRow}>
            <input className={styles.envKey} value={row.key} onChange={(e) => setRow(i, { key: e.target.value })} placeholder="DD_API_KEY" />
            <input
              className={styles.envValue}
              type="password"
              value={row.value}
              onChange={(e) => setRow(i, { value: e.target.value })}
              placeholder="value"
            />
            <button type="button" className={styles.chipX} onClick={() => setEnvRows((r) => r.filter((_, idx) => idx !== i))} aria-label="Remove env var">
              <Icon icon={X} size={12} />
            </button>
          </div>
        ))}
        <button type="button" className={styles.addEnv} onClick={() => setEnvRows((r) => [...r, { key: '', value: '' }])}>
          <Icon icon={Plus} size={12} /> Add variable
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.formActions}>
        <button type="button" className={styles.primary} onClick={() => void submit()} disabled={saving}>
          {isEdit ? 'Save' : 'Add server'}
        </button>
        <button type="button" className={styles.secondary} onClick={onDone} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Server management section ─────────────────────────────────────────────────

interface ProbeState {
  loading: boolean
  result: McpToolsResult | null
}

export function McpServersSection({
  projectId,
  servers,
  showUndo,
}: {
  projectId: number
  servers: McpServerSummary[]
  showUndo: (message: string, onUndo: () => void, actionLabel?: string) => void
}): JSX.Element {
  const [mode, setMode] = useState<'idle' | 'new' | string>('idle')
  const [probes, setProbes] = useState<Record<string, ProbeState>>({})

  const check = async (id: string): Promise<void> => {
    setProbes((p) => ({ ...p, [id]: { loading: true, result: null } }))
    try {
      const result = await window.electron.ipc.invoke('resources:mcp-list-tools', projectId, id)
      setProbes((p) => ({ ...p, [id]: { loading: false, result } }))
    } catch (err) {
      setProbes((p) => ({ ...p, [id]: { loading: false, result: { ok: false, error: err instanceof Error ? err.message : 'Probe failed' } } }))
    }
  }

  const remove = (server: McpServerSummary): void => {
    const run = async (): Promise<void> => {
      await window.electron.ipc.invoke('resources:mcp-delete', projectId, server.id)
      showUndo(`Disconnected ${server.label}`, () =>
        fire(window.electron.ipc.invoke('resources:mcp-restore', projectId, server.id), 'mcp-restore')
      )
    }
    fire(run(), 'mcp-delete')
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>Connect a tool</span>
        {mode === 'idle' && (
          <button type="button" className={styles.addServer} onClick={() => setMode('new')}>
            <Icon icon={Plus} size={13} /> Add
          </button>
        )}
      </div>

      {mode === 'new' && <ServerForm projectId={projectId} existing={null} onDone={() => setMode('idle')} />}

      {servers.length === 0 && mode === 'idle' && (
        <div className={styles.sectionEmpty}>No tools connected. Add an MCP server so resources can pull live values.</div>
      )}

      {servers.map((server) => {
        const probe = probes[server.id]
        return (
          <div key={server.id} className={styles.serverRow}>
            {mode === server.id ? (
              <ServerForm projectId={projectId} existing={server} onDone={() => setMode('idle')} />
            ) : (
              <>
                <div className={styles.serverInfo}>
                  <span className={styles.serverLabel}>{server.label}</span>
                  <span className={styles.serverCmd}>{server.command}</span>
                  {server.envKeys.length > 0 && <span className={styles.serverEnv}>{server.envKeys.length} secret{server.envKeys.length > 1 ? 's' : ''}</span>}
                </div>
                <div className={styles.serverActions}>
                  <button type="button" className={styles.iconBtn} onClick={() => void check(server.id)} title="Check the server starts + list its tools">
                    <Icon icon={probe?.loading ? RefreshCw : Check} size={13} className={probe?.loading ? styles.spin : undefined} />
                  </button>
                  <button type="button" className={styles.iconBtn} onClick={() => setMode(server.id)} aria-label="Edit server">
                    <Icon icon={Pencil} size={13} />
                  </button>
                  <button type="button" className={styles.iconBtn} onClick={() => remove(server)} aria-label="Disconnect server">
                    <Icon icon={Trash2} size={13} />
                  </button>
                </div>
                {probe && !probe.loading && probe.result && (
                  <div className={probe.result.ok ? styles.probeOk : styles.probeErr}>
                    {probe.result.ok
                      ? `Server starts · ${probe.result.tools.length} tool${probe.result.tools.length === 1 ? '' : 's'} found`
                      : probe.result.error}
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Resource wiring dialog (resource-first) ───────────────────────────────────

/**
 * Wires a single resource to a configured server tool so a resolve can pull a
 * live value. Tool discovery is the happy path; a manual tool name works if the
 * server can't be probed. All validation is authoritative in main.
 */
export function ConnectResourceDialog({
  projectId,
  resource,
  servers,
  onClose,
}: {
  projectId: number
  resource: Resource
  servers: McpServerSummary[]
  onClose: () => void
}): JSX.Element {
  const [serverId, setServerId] = useState(
    resource.mcpServer !== null && servers.some((s) => s.id === resource.mcpServer)
      ? resource.mcpServer
      : (servers[0]?.id ?? '')
  )
  const [toolName, setToolName] = useState(resource.toolName ?? '')
  const [argsText, setArgsText] = useState(JSON.stringify(resource.toolArgs ?? {}, null, 2))
  const [tools, setTools] = useState<McpToolInfo[] | null>(null)
  const [probing, setProbing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const selectedTool = tools?.find((t) => t.name === toolName)

  const discover = async (): Promise<void> => {
    if (serverId.length === 0) return
    setProbing(true)
    setError(null)
    try {
      const result = await window.electron.ipc.invoke('resources:mcp-list-tools', projectId, serverId)
      if (result.ok) setTools(result.tools)
      else setError(result.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the server')
    } finally {
      setProbing(false)
    }
  }

  const connect = async (): Promise<void> => {
    setError(null)
    let toolArgs: Record<string, unknown>
    try {
      const parsed: unknown = argsText.trim().length === 0 ? {} : JSON.parse(argsText)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setError('Tool args must be a JSON object')
        return
      }
      toolArgs = parsed as Record<string, unknown>
    } catch {
      setError('Tool args must be valid JSON')
      return
    }
    setSaving(true)
    try {
      await window.electron.ipc.invoke('resources:mcp-connect', resource.id, { serverId, toolName, toolArgs })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.dialogBackdrop} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dialogHead}>
          <span className={styles.dialogTitle}>Connect live value</span>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <Icon icon={X} size={14} />
          </button>
        </div>
        <div className={styles.dialogResource}>{resource.title}</div>

        {servers.length === 0 ? (
          <div className={styles.sectionEmpty}>Add a tool below first, then connect this resource to it.</div>
        ) : (
          <>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Server</span>
              <select className={styles.input} value={serverId} onChange={(e) => { setServerId(e.target.value); setTools(null) }}>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <div className={styles.field}>
              <div className={styles.discoverRow}>
                <span className={styles.fieldLabel}>Tool</span>
                <button type="button" className={styles.linkBtn} onClick={() => void discover()} disabled={probing || serverId.length === 0}>
                  {probing ? 'Discovering…' : 'Discover tools'}
                </button>
              </div>
              {tools && tools.length > 0 ? (
                <select className={styles.input} aria-label="Tool" value={toolName} onChange={(e) => setToolName(e.target.value)}>
                  <option value="">Select a tool…</option>
                  {tools.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input className={styles.input} aria-label="Tool" value={toolName} onChange={(e) => setToolName(e.target.value)} placeholder="query" />
              )}
              {selectedTool?.description && <div className={styles.toolDesc}>{selectedTool.description}</div>}
              {selectedTool?.inputSchema !== undefined && (
                <details className={styles.schema}>
                  <summary>Input schema</summary>
                  <pre>{safeStringify(selectedTool.inputSchema)}</pre>
                </details>
              )}
            </div>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Tool args (JSON)</span>
              <textarea className={styles.textarea} aria-label="Tool args" value={argsText} onChange={(e) => setArgsText(e.target.value)} rows={4} spellCheck={false} />
            </label>

            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.formActions}>
              <button type="button" className={styles.primary} onClick={() => void connect()} disabled={saving || toolName.trim().length === 0}>
                <Icon icon={Zap} size={13} /> Connect
              </button>
              <button type="button" className={styles.secondary} onClick={onClose} disabled={saving}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
