import { useState } from 'react'
import type { RoutingRule, CreateRoutingRulePayload, Project } from '@shared/ipc-channels'
import styles from './RoutingRulesSection.module.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_OPTIONS = ['PullRequest', 'Issue', 'Release', 'Discussion', 'Commit', 'CheckSuite']
const REASON_OPTIONS = [
  'assign',
  'comment',
  'mention',
  'review_requested',
  'security_alert',
  'state_change',
  'subscribed',
  'team_mention',
]

// ── Rule card ─────────────────────────────────────────────────────────────────

interface RuleCardProps {
  rule: RoutingRule
  onRemove: (id: number) => void | Promise<void>
}

function RuleCard({ rule, onRemove }: RuleCardProps) {
  const [isRemoving, setIsRemoving] = useState(false)

  const conditions: string[] = []
  if (rule.matchType) conditions.push(`type: ${rule.matchType}`)
  if (rule.matchReason) conditions.push(`reason: ${rule.matchReason}`)
  if (rule.matchRepoOwner && rule.matchRepoName) {
    conditions.push(`repo: ${rule.matchRepoOwner}/${rule.matchRepoName}`)
  } else if (rule.matchRepoOwner) {
    conditions.push(`owner: ${rule.matchRepoOwner}`)
  } else if (rule.matchRepoName) {
    conditions.push(`repo: ${rule.matchRepoName}`)
  }
  if (rule.matchOrg) conditions.push(`org: ${rule.matchOrg}`)

  const handleRemove = async () => {
    setIsRemoving(true)
    try {
      await onRemove(rule.id)
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <div className={styles.ruleCard}>
      <div className={styles.ruleConditions}>
        {conditions.map((c) => (
          <span key={c} className={styles.conditionChip}>
            {c}
          </span>
        ))}
        <span className={styles.ruleArrow}>→</span>
        <span className={styles.ruleTarget}>{rule.projectName}</span>
      </div>
      <button
        type="button"
        className={styles.ruleRemove}
        onClick={() => void handleRemove()}
        aria-label={`Remove routing rule for ${rule.projectName}`}
        disabled={isRemoving}
      >
        ×
      </button>
    </div>
  )
}

// ── Add rule form ─────────────────────────────────────────────────────────────

interface AddRuleFormProps {
  projects: Project[]
  onAdd: (payload: CreateRoutingRulePayload) => Promise<void>
  onCancel: () => void
}

function AddRuleForm({ projects, onAdd, onCancel }: AddRuleFormProps) {
  const [projectId, setProjectId] = useState<number | ''>(projects[0]?.id ?? '')
  const [useType, setUseType] = useState(false)
  const [matchType, setMatchType] = useState(TYPE_OPTIONS[0])
  const [useReason, setUseReason] = useState(false)
  const [matchReason, setMatchReason] = useState(REASON_OPTIONS[0])
  const [useRepo, setUseRepo] = useState(false)
  const [matchRepoOwner, setMatchRepoOwner] = useState('')
  const [matchRepoName, setMatchRepoName] = useState('')
  const [useOrg, setUseOrg] = useState(false)
  const [matchOrg, setMatchOrg] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (projectId === '') {
      setError('Select a project to route to.')
      return
    }
    if (!useType && !useReason && !useRepo && !useOrg) {
      setError('Add at least one condition.')
      return
    }
    if (useRepo && !matchRepoOwner.trim() && !matchRepoName.trim()) {
      setError('Enter an owner or repo name for the Repo condition.')
      return
    }
    if (useOrg && !matchOrg.trim()) {
      setError('Enter an org name.')
      return
    }

    const payload: CreateRoutingRulePayload = {
      projectId: projectId as number,
      ...(useType ? { matchType } : {}),
      ...(useReason ? { matchReason } : {}),
      ...(useRepo && matchRepoOwner.trim() ? { matchRepoOwner: matchRepoOwner.trim() } : {}),
      ...(useRepo && matchRepoName.trim() ? { matchRepoName: matchRepoName.trim() } : {}),
      ...(useOrg ? { matchOrg: matchOrg.trim() } : {}),
    }

    setIsSaving(true)
    try {
      await onAdd(payload)
      onCancel()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rule.')
      setIsSaving(false)
    }
  }

  return (
    <form className={styles.addForm} onSubmit={(e) => void handleSubmit(e)}>
      {/* Project selector */}
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Route to</label>
        <select
          className={styles.select}
          value={projectId}
          onChange={(e) => setProjectId(Number(e.target.value))}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Conditions */}
      <div className={styles.conditionsSection}>
        <span className={styles.conditionsLabel}>When all of these match:</span>

        {/* Type */}
        <div className={styles.conditionRow}>
          <label className={styles.conditionToggle}>
            <input
              type="checkbox"
              checked={useType}
              onChange={(e) => setUseType(e.target.checked)}
            />
            <span>Type</span>
          </label>
          {useType && (
            <select
              className={styles.select}
              value={matchType}
              onChange={(e) => setMatchType(e.target.value)}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Reason */}
        <div className={styles.conditionRow}>
          <label className={styles.conditionToggle}>
            <input
              type="checkbox"
              checked={useReason}
              onChange={(e) => setUseReason(e.target.checked)}
            />
            <span>Reason</span>
          </label>
          {useReason && (
            <select
              className={styles.select}
              value={matchReason}
              onChange={(e) => setMatchReason(e.target.value)}
            >
              {REASON_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Repo */}
        <div className={styles.conditionRow}>
          <label className={styles.conditionToggle}>
            <input
              type="checkbox"
              checked={useRepo}
              onChange={(e) => setUseRepo(e.target.checked)}
            />
            <span>Repo</span>
          </label>
          {useRepo && (
            <div className={styles.repoInputs}>
              <input
                className={styles.input}
                type="text"
                placeholder="owner"
                value={matchRepoOwner}
                onChange={(e) => setMatchRepoOwner(e.target.value)}
              />
              <span className={styles.repoDivider}>/</span>
              <input
                className={styles.input}
                type="text"
                placeholder="repo"
                value={matchRepoName}
                onChange={(e) => setMatchRepoName(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Org */}
        <div className={styles.conditionRow}>
          <label className={styles.conditionToggle}>
            <input
              type="checkbox"
              checked={useOrg}
              onChange={(e) => setUseOrg(e.target.checked)}
            />
            <span>Org</span>
          </label>
          {useOrg && (
            <input
              className={styles.input}
              type="text"
              placeholder="org name"
              value={matchOrg}
              onChange={(e) => setMatchOrg(e.target.value)}
              autoFocus
            />
          )}
        </div>
      </div>

      {error && <p className={styles.errorText}>{error}</p>}

      <div className={styles.addFormActions}>
        <button type="submit" className={styles.btnPrimary} disabled={isSaving}>
          {isSaving ? 'Adding…' : 'Add Rule'}
        </button>
        <button type="button" className={styles.btnGhost} onClick={onCancel} disabled={isSaving}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Routing rules section ─────────────────────────────────────────────────────

interface Props {
  rules: RoutingRule[]
  projects: Project[]
  onAdd: (payload: CreateRoutingRulePayload) => Promise<void>
  onRemove: (id: number) => void | Promise<void>
  onApplyToInbox: () => Promise<{ matched: number }>
  isLoading?: boolean
}

export function RoutingRulesSection({ rules, projects, onAdd, onRemove, onApplyToInbox, isLoading }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [applyResult, setApplyResult] = useState<string | null>(null)
  const [isApplying, setIsApplying] = useState(false)

  const handleApplyToInbox = async () => {
    setApplyResult(null)
    setIsApplying(true)
    try {
      const { matched } = await onApplyToInbox()
      setApplyResult(
        matched === 0
          ? 'No inbox notifications matched any rule.'
          : `Routed ${matched} notification${matched === 1 ? '' : 's'}.`,
      )
    } catch {
      setApplyResult('Failed to apply rules.')
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <div className={styles.root}>
      {/* Rule list */}
      {rules.length === 0 && !showForm ? (
        <p className={styles.emptyText}>
          {isLoading
            ? 'Loading rules…'
            : 'No routing rules. Notifications stay in the Inbox until assigned manually.'}
        </p>
      ) : (
        <div className={styles.ruleList}>
          {rules.map((r) => (
            <RuleCard key={r.id} rule={r} onRemove={onRemove} />
          ))}
        </div>
      )}

      {/* Add form */}
      {showForm ? (
        <AddRuleForm
          projects={projects}
          onAdd={onAdd}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.addButton}
            onClick={() => {
              setApplyResult(null)
              setShowForm(true)
            }}
            disabled={projects.length === 0}
          >
            + Add Rule
          </button>
          {rules.length > 0 && (
            <button
              type="button"
              className={styles.applyButton}
              onClick={() => void handleApplyToInbox()}
              disabled={isApplying}
            >
              {isApplying ? 'Applying…' : 'Apply to Inbox'}
            </button>
          )}
        </div>
      )}

      {applyResult && (
        <p className={styles.applyResult} role="status" aria-live="polite">
          {applyResult}
        </p>
      )}
    </div>
  )
}
