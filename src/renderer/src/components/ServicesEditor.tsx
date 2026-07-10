import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { normalizeServiceName, validateServiceName } from '@shared/service-name'
import { Icon } from './Icon'
import styles from './ServicesEditor.module.css'

interface ServicesEditorProps {
  /** The raw services on the project card (may hold legacy mixed-case / invalid values). */
  services: string[]
  /** Attach a validated, normalized service key to the card. */
  onAdd: (key: string) => void
  /** Detach a service (by normalized key) from the card. Does NOT delete its runbook file. */
  onRemove: (key: string) => void
  /** True while a card mutation is in flight; disables the controls. */
  busy?: boolean
}

/** A service as shown in the editor list: its display form plus the key used to detach it. */
interface EditorRow {
  display: string
  key: string
}

/**
 * Dedupe the card's services by normalized key (first occurrence wins), matching how
 * the runbook list collapses them. Keeps legacy/mixed-case/invalid entries visible so
 * they can be detached rather than silently hidden.
 */
function dedupeByKey(services: string[]): EditorRow[] {
  const seen = new Set<string>()
  const rows: EditorRow[] = []
  for (const raw of services) {
    const key = normalizeServiceName(raw)
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    rows.push({ display: raw.trim(), key })
  }
  return rows
}

/**
 * The services editor for a project's Runbooks tab (#116). Presentational: owns only the
 * add-input text and its live validation preview; all persistence happens in the parent via
 * the `onAdd` / `onRemove` callbacks. Add uses the same `validateServiceName` gate as the
 * write path, previews the normalized key, rejects unsafe names with the returned reason, and
 * dedupes by normalized key. Remove detaches the service from the card only.
 */
export function ServicesEditor({ services, onAdd, onRemove, busy = false }: ServicesEditorProps): JSX.Element {
  const [text, setText] = useState('')

  const rows = useMemo(() => dedupeByKey(services), [services])
  const existingKeys = useMemo(() => new Set(rows.map((r) => r.key)), [rows])

  const validation = text.length > 0 ? validateServiceName(text) : null
  const isDuplicate = validation?.ok === true && existingKeys.has(validation.key)
  const canAdd = !busy && validation?.ok === true && !isDuplicate

  const submit = (): void => {
    if (!canAdd || validation?.ok !== true) return
    onAdd(validation.key)
    setText('')
  }

  return (
    <div className={styles.editor}>
      <div className={styles.addRow}>
        <Icon icon={Plus} size={15} className={styles.addIcon} />
        <input
          className={styles.addInput}
          value={text}
          placeholder="Add a service (e.g. payments-api)…"
          aria-label="Add a service"
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button type="button" className={styles.addButton} onClick={submit} disabled={!canAdd}>
          Add
        </button>
      </div>

      {validation !== null && (
        <div className={styles.preview}>
          {validation.ok ? (
            isDuplicate ? (
              <span className={styles.dupe}>
                <code>{validation.key}</code> is already on this project.
              </span>
            ) : (
              <span className={styles.ok}>
                Saved as <code>{validation.key}</code>
              </span>
            )
          ) : (
            <span className={styles.error}>{validation.reason}</span>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.key} className={styles.chip}>
              <span className={styles.chipName}>{row.display}</span>
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => onRemove(row.key)}
                disabled={busy}
                aria-label={`Remove ${row.display}`}
                title="Detach from this project (keeps the runbook file)"
              >
                <Icon icon={X} size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className={styles.note}>Removing a service detaches it from this project. Its runbook file on disk is kept.</p>
    </div>
  )
}
