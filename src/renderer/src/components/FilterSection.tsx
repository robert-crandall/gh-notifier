import { useState } from 'react'
import type { FilterDimension, FilterScope, NotificationFilter } from '@shared/ipc-channels'
import styles from './FilterSection.module.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const DIMENSIONS: { value: FilterDimension; label: string; inputType: 'text' | 'select' }[] = [
  { value: 'type', label: 'Type', inputType: 'select' },
  { value: 'reason', label: 'Reason', inputType: 'select' },
  { value: 'state', label: 'State', inputType: 'select' },
  { value: 'org', label: 'Org', inputType: 'text' },
  { value: 'repo', label: 'Repo', inputType: 'text' },
  { value: 'author', label: 'Author', inputType: 'text' },
]

const DIMENSION_OPTIONS: Record<string, string[]> = {
  type: ['PullRequest', 'Issue', 'Release', 'Discussion', 'Commit', 'CheckSuite'],
  reason: ['assign', 'comment', 'mention', 'review_requested', 'security_alert', 'state_change', 'subscribed', 'team_mention'],
  state: ['open', 'closed', 'merged'],
}

// ── Filter chip ───────────────────────────────────────────────────────────────

interface ChipProps {
  filter: NotificationFilter
  onRemove: (id: number) => void
}

function FilterChip({ filter, onRemove }: ChipProps) {
  const label =
    filter.scope === 'repo'
      ? `${filter.scopeOwner}/${filter.scopeRepo} · ${filter.dimension}: ${filter.value}`
      : `${filter.dimension}: ${filter.value}`

  return (
    <span className={`${styles.chip} ${filter.scope === 'repo' ? styles.chipRepo : ''}`}>
      <span className={styles.chipLabel}>{label}</span>
      <button
        className={styles.chipRemove}
        onClick={() => onRemove(filter.id)}
        aria-label={`Remove filter ${label}`}
        type="button"
      >
        ×
      </button>
    </span>
  )
}

// ── Add-filter form ───────────────────────────────────────────────────────────

interface AddFormProps {
  onAdd: (
    dimension: FilterDimension,
    value: string,
    scope: FilterScope,
    scopeOwner?: string,
    scopeRepo?: string,
  ) => Promise<void>
  onCancel: () => void
}

function AddFilterForm({ onAdd, onCancel }: AddFormProps) {
  const [dimension, setDimension] = useState<FilterDimension>('type')
  const [value, setValue] = useState('')
  const [scope, setScope] = useState<FilterScope>('global')
  const [scopeOwner, setScopeOwner] = useState('')
  const [scopeRepo, setScopeRepo] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dimConfig = DIMENSIONS.find((d) => d.value === dimension)!
  const options = DIMENSION_OPTIONS[dimension]

  // Reset value and scope when dimension changes
  const handleDimensionChange = (d: FilterDimension) => {
    setDimension(d)
    setValue(DIMENSION_OPTIONS[d]?.[0] ?? '')
    if (d !== 'type') setScope('global')
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedValue = value.trim()
    if (!trimmedValue) {
      setError('Value is required.')
      return
    }
    if (scope === 'repo' && (!scopeOwner.trim() || !scopeRepo.trim())) {
      setError('Repository owner and name are required for per-repo filters.')
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      await onAdd(
        dimension,
        trimmedValue,
        scope,
        scope === 'repo' ? scopeOwner.trim() : undefined,
        scope === 'repo' ? scopeRepo.trim() : undefined,
      )
      onCancel()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create filter.')
      setIsSaving(false)
    }
  }

  return (
    <form className={styles.addForm} onSubmit={(e) => void handleSubmit(e)}>
      <div className={styles.addFormRow}>
        {/* Dimension selector */}
        <select
          className={styles.select}
          value={dimension}
          onChange={(e) => handleDimensionChange(e.target.value as FilterDimension)}
        >
          {DIMENSIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>

        {/* Value input */}
        {dimConfig.inputType === 'select' ? (
          <select
            className={styles.select}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            {(options ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={styles.input}
            type="text"
            placeholder={`Filter by ${dimension}…`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        )}
      </div>

      {/* Per-repo scope toggle */}
      <div className={styles.scopeRow}>
          <label className={styles.scopeLabel}>
            <input
              type="checkbox"
              checked={scope === 'repo'}
              onChange={(e) => setScope(e.target.checked ? 'repo' : 'global')}
            />
            <span>Apply to specific repo only</span>
          </label>
          {scope === 'repo' && (
            <div className={styles.repoInputs}>
              <input
                className={styles.input}
                type="text"
                placeholder="owner"
                value={scopeOwner}
                onChange={(e) => setScopeOwner(e.target.value)}
              />
              <span className={styles.repoDivider}>/</span>
              <input
                className={styles.input}
                type="text"
                placeholder="repo"
                value={scopeRepo}
                onChange={(e) => setScopeRepo(e.target.value)}
              />
            </div>
          )}
        </div>

      {error && <p className={styles.errorText}>{error}</p>}

      <div className={styles.addFormActions}>
        <button type="submit" className={styles.btnPrimary} disabled={isSaving}>
          {isSaving ? 'Adding…' : 'Add Filter'}
        </button>
        <button type="button" className={styles.btnGhost} onClick={onCancel} disabled={isSaving}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Filter section ────────────────────────────────────────────────────────────

interface Props {
  filters: NotificationFilter[]
  onAdd: (
    dimension: FilterDimension,
    value: string,
    scope: FilterScope,
    scopeOwner?: string,
    scopeRepo?: string,
  ) => Promise<void>
  onRemove: (id: number) => void
}

export function FilterSection({ filters, onAdd, onRemove }: Props) {
  const [showForm, setShowForm] = useState(false)

  const globalFilters = filters.filter((f) => f.scope === 'global')
  const repoFilters = filters.filter((f) => f.scope === 'repo')

  return (
    <div className={styles.root}>
      {/* Active filters */}
      {filters.length === 0 && !showForm ? (
        <p className={styles.emptyText}>No active filters. All notifications will be shown.</p>
      ) : (
        <>
          {globalFilters.length > 0 && (
            <div className={styles.filterGroup}>
              <span className={styles.groupLabel}>Global</span>
              <div className={styles.chips}>
                {globalFilters.map((f) => (
                  <FilterChip key={f.id} filter={f} onRemove={onRemove} />
                ))}
              </div>
            </div>
          )}

          {repoFilters.length > 0 && (
            <div className={styles.filterGroup}>
              <span className={styles.groupLabel}>Per-repo</span>
              <div className={styles.chips}>
                {repoFilters.map((f) => (
                  <FilterChip key={f.id} filter={f} onRemove={onRemove} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Two-tier hierarchy explanation — only relevant for type filters */}
      {globalFilters.some((f) => f.dimension === 'type') && (
        <p className={styles.hierarchyNote}>
          Global type filters are a non-overridable floor. Per-repo type filters can only
          suppress additional types — they cannot un-suppress a globally suppressed type.
        </p>
      )}

      {/* Add filter */}
      {showForm ? (
        <AddFilterForm onAdd={onAdd} onCancel={() => setShowForm(false)} />
      ) : (
        <button
          type="button"
          className={styles.addButton}
          onClick={() => setShowForm(true)}
        >
          + Add Filter
        </button>
      )}
    </div>
  )
}
