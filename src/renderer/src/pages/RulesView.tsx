import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Trash2, Plus, X, FolderInput, EyeOff, ArrowRightLeft } from 'lucide-react'
import type { NotificationType, Project, RepoRule, RoutingRule } from '@shared/ipc-channels'
import { Icon } from '../components/Icon'
import {
  type RuleConditionInput,
  EMPTY_CONDITION,
  buildRoutingPayload,
  validateRepoRule,
  describeConditions,
} from './rulesForm'
import styles from './RulesView.module.css'

const NOTIFICATION_TYPES: NotificationType[] = [
  'PullRequest',
  'Issue',
  'Release',
  'Discussion',
  'Commit',
  'CheckSuite',
]

interface RulesViewProps {
  onClose: () => void
  /** Called after a mutation so the rest of the app (inbox counts, rail) can refresh. */
  onRulesChanged?: () => void
}

function ConditionFields({
  value,
  onChange,
}: {
  value: RuleConditionInput
  onChange: (v: RuleConditionInput) => void
}): JSX.Element {
  return (
    <div className={styles.conditionGrid}>
      <select
        className={styles.input}
        value={value.matchType}
        onChange={(e) => onChange({ ...value, matchType: e.target.value })}
        aria-label="Notification type"
      >
        <option value="">Any type</option>
        {NOTIFICATION_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <input
        className={styles.input}
        placeholder="Reason (e.g. review_requested)"
        value={value.matchReason}
        onChange={(e) => onChange({ ...value, matchReason: e.target.value })}
        aria-label="Reason"
      />
      <input
        className={styles.input}
        placeholder="Repo owner"
        value={value.matchRepoOwner}
        onChange={(e) => onChange({ ...value, matchRepoOwner: e.target.value })}
        aria-label="Repo owner"
      />
      <input
        className={styles.input}
        placeholder="Repo name"
        value={value.matchRepoName}
        onChange={(e) => onChange({ ...value, matchRepoName: e.target.value })}
        aria-label="Repo name"
      />
      <input
        className={styles.input}
        placeholder="Org contains…"
        value={value.matchOrg}
        onChange={(e) => onChange({ ...value, matchOrg: e.target.value })}
        aria-label="Org contains"
      />
    </div>
  )
}

export function RulesView({ onClose, onRulesChanged }: RulesViewProps): JSX.Element {
  const [repoRules, setRepoRules] = useState<RepoRule[]>([])
  const [routingRules, setRoutingRules] = useState<RoutingRule[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [applyResult, setApplyResult] = useState<string | null>(null)
  const [isApplying, setIsApplying] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const [repos, routing, projectList] = await Promise.all([
        window.electron.ipc.invoke('repo-rules:list'),
        window.electron.ipc.invoke('routing-rules:list'),
        window.electron.ipc.invoke('projects:list'),
      ])
      if (!mountedRef.current) return
      setRepoRules(repos)
      setRoutingRules(routing)
      // listProjects already excludes soft-deleted projects; both active and
      // snoozed are valid route targets (routing to a notification-snoozed project wakes it).
      setProjects(projectList)
    } catch (err) {
      console.error('[Rules] load failed:', err)
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const projectName = useCallback(
    (id: number): string => projects.find((p) => p.id === id)?.name ?? `#${id}`,
    [projects],
  )

  const routeRules = routingRules.filter((r) => r.action === 'route')
  const suppressRules = routingRules.filter((r) => r.action === 'suppress')

  const afterMutation = useCallback(async (): Promise<void> => {
    // A rule change can invalidate a prior "Routed N threads" message, so clear it.
    if (mountedRef.current) setApplyResult(null)
    await load()
    onRulesChanged?.()
  }, [load, onRulesChanged])

  return (
    <main className={styles.main}>
      <header className={styles.toolbar}>
        <button type="button" className={styles.back} onClick={onClose} aria-label="Back to focus">
          <Icon icon={ArrowLeft} size={16} />
        </button>
        <span className={styles.title}>Notification rules</span>
      </header>

      <div className={styles.content}>
        {isLoading ? (
          <div className={styles.empty}>Loading…</div>
        ) : (
          <>
            <RepoRuleSection
              rules={repoRules}
              projects={projects}
              projectName={projectName}
              onChanged={afterMutation}
            />
            <RoutingRuleSection
              action="route"
              icon={ArrowRightLeft}
              heading="Route rules"
              description="Ordered matchers. When you apply them, the first rule that matches an inbox thread wins and moves it to a project."
              rules={routeRules}
              projects={projects}
              onChanged={afterMutation}
              footer={
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={isApplying}
                  onClick={() => {
                    if (isApplying) return
                    setIsApplying(true)
                    void (async () => {
                      try {
                        const result = await window.electron.ipc.invoke('routing-rules:apply-to-inbox')
                        // Reload first (which clears any prior message), then show the fresh count.
                        await afterMutation()
                        if (mountedRef.current) {
                          setApplyResult(
                            result.matched === 0
                              ? 'No inbox threads matched.'
                              : `Routed ${result.matched} thread${result.matched === 1 ? '' : 's'}.`,
                          )
                        }
                      } catch (err) {
                        console.error('[Rules] apply-to-inbox failed:', err)
                      } finally {
                        if (mountedRef.current) setIsApplying(false)
                      }
                    })()
                  }}
                >
                  {isApplying ? 'Applying…' : 'Apply to inbox now'}
                </button>
              }
              footerNote={applyResult}
            />
            <RoutingRuleSection
              action="suppress"
              icon={EyeOff}
              heading="Filters"
              description="Read-time filters. Threads matching a filter are hidden from the inbox and each project's notification list."
              rules={suppressRules}
              projects={projects}
              onChanged={afterMutation}
            />
          </>
        )}
      </div>
    </main>
  )
}

// ── Repo rules ────────────────────────────────────────────────────────────────

function RepoRuleSection({
  rules,
  projects,
  projectName,
  onChanged,
}: {
  rules: RepoRule[]
  projects: Project[]
  projectName: (id: number) => string
  onChanged: () => Promise<void>
}): JSX.Element {
  const [adding, setAdding] = useState(false)
  const [owner, setOwner] = useState('')
  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setOwner('')
    setName('')
    setProjectId(null)
    setError(null)
    setAdding(false)
  }

  const submit = (): void => {
    const validation = validateRepoRule(owner, name, projectId)
    if (!validation.ok) {
      setError(validation.error)
      return
    }
    void (async () => {
      try {
        await window.electron.ipc.invoke('repo-rules:create', owner.trim(), name.trim(), projectId as number)
        reset()
        await onChanged()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create the rule.')
      }
    })()
  }

  const remove = (id: number): void => {
    void (async () => {
      try {
        await window.electron.ipc.invoke('repo-rules:delete', id)
        await onChanged()
      } catch (err) {
        console.error('[Rules] delete repo rule failed:', err)
      }
    })()
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>Repo defaults</h2>
          <p className={styles.sectionDesc}>
            New notifications from a repo are assigned to a project automatically at sync time.
          </p>
        </div>
        {!adding && (
          <button type="button" className={styles.addButton} onClick={() => setAdding(true)}>
            <Icon icon={Plus} size={14} />
            Add
          </button>
        )}
      </div>

      {rules.length === 0 && !adding && <div className={styles.emptyRow}>No repo defaults yet.</div>}

      {rules.map((rule) => (
        <div key={rule.id} className={styles.ruleRow}>
          <Icon icon={FolderInput} size={15} className={styles.ruleIcon} />
          <span className={styles.ruleText}>
            {rule.repoOwner}/{rule.repoName}
          </span>
          <span className={styles.ruleTarget}>→ {projectName(rule.projectId)}</span>
          <button
            type="button"
            className={styles.deleteButton}
            onClick={() => remove(rule.id)}
            aria-label="Delete rule"
          >
            <Icon icon={Trash2} size={14} />
          </button>
        </div>
      ))}

      {adding && (
        <div className={styles.addForm}>
          <div className={styles.repoRow}>
            <input
              className={styles.input}
              placeholder="Repo owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              aria-label="Repo owner"
            />
            <input
              className={styles.input}
              placeholder="Repo name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Repo name"
            />
            <select
              className={styles.input}
              value={projectId ?? ''}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
              aria-label="Project"
            >
              <option value="">Route to…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {error && <span className={styles.error}>{error}</span>}
          <div className={styles.formActions}>
            <button type="button" className={styles.primaryButton} onClick={submit}>
              Create rule
            </button>
            <button type="button" className={styles.ghostButton} onClick={reset} aria-label="Cancel">
              <Icon icon={X} size={14} />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// ── Route / suppress rules ──────────────────────────────────────────────────────

function RoutingRuleSection({
  action,
  icon,
  heading,
  description,
  rules,
  projects,
  onChanged,
  footer,
  footerNote,
}: {
  action: 'route' | 'suppress'
  icon: typeof EyeOff
  heading: string
  description: string
  rules: RoutingRule[]
  projects: Project[]
  onChanged: () => Promise<void>
  footer?: JSX.Element
  footerNote?: string | null
}): JSX.Element {
  const [adding, setAdding] = useState(false)
  const [condition, setCondition] = useState<RuleConditionInput>(EMPTY_CONDITION)
  const [projectId, setProjectId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setCondition(EMPTY_CONDITION)
    setProjectId(null)
    setError(null)
    setAdding(false)
  }

  const submit = (): void => {
    const result = buildRoutingPayload(action, condition, projectId)
    if (!result.ok) {
      setError(result.error)
      return
    }
    void (async () => {
      try {
        await window.electron.ipc.invoke('routing-rules:create', result.payload)
        reset()
        await onChanged()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create the rule.')
      }
    })()
  }

  const remove = (id: number): void => {
    void (async () => {
      try {
        await window.electron.ipc.invoke('routing-rules:delete', id)
        await onChanged()
      } catch (err) {
        console.error('[Rules] delete routing rule failed:', err)
      }
    })()
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>{heading}</h2>
          <p className={styles.sectionDesc}>{description}</p>
        </div>
        {!adding && (
          <button type="button" className={styles.addButton} onClick={() => setAdding(true)}>
            <Icon icon={Plus} size={14} />
            Add
          </button>
        )}
      </div>

      {rules.length === 0 && !adding && (
        <div className={styles.emptyRow}>No {action === 'route' ? 'route rules' : 'filters'} yet.</div>
      )}

      {rules.map((rule, i) => (
        <div key={rule.id} className={styles.ruleRow}>
          <span className={styles.ruleOrder}>{i + 1}</span>
          <Icon icon={icon} size={15} className={styles.ruleIcon} />
          <span className={styles.ruleText}>{describeConditions(rule)}</span>
          {action === 'route' && (
            <span className={styles.ruleTarget}>→ {rule.projectName ?? `#${rule.projectId ?? '?'}`}</span>
          )}
          <button
            type="button"
            className={styles.deleteButton}
            onClick={() => remove(rule.id)}
            aria-label="Delete rule"
          >
            <Icon icon={Trash2} size={14} />
          </button>
        </div>
      ))}

      {adding && (
        <div className={styles.addForm}>
          <ConditionFields value={condition} onChange={setCondition} />
          {action === 'route' && (
            <select
              className={styles.input}
              value={projectId ?? ''}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
              aria-label="Project"
            >
              <option value="">Route to…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {error && <span className={styles.error}>{error}</span>}
          <div className={styles.formActions}>
            <button type="button" className={styles.primaryButton} onClick={submit}>
              Create rule
            </button>
            <button type="button" className={styles.ghostButton} onClick={reset} aria-label="Cancel">
              <Icon icon={X} size={14} />
            </button>
          </div>
        </div>
      )}

      {(footer || footerNote) && (
        <div className={styles.sectionFooter}>
          {footer}
          {footerNote && <span className={styles.footerNote}>{footerNote}</span>}
        </div>
      )}
    </section>
  )
}
