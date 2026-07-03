import { useEffect, useState } from 'react'
import {
  Search,
  ExternalLink,
  Trash2,
  Plus,
  X,
  TriangleAlert,
  CircleCheck,
  Database,
  CircleHelp,
} from 'lucide-react'
import type {
  CaptureProposal,
  ResolveResult,
  Resource,
  ResourceGroup,
} from '@shared/ipc-channels'
import { Icon } from './Icon'
import { fire, openExternal } from '../ipc'
import styles from './ResourcePanel.module.css'

interface ResourcePanelProps {
  projectId: number
  showUndo: (message: string, onUndo: () => void, actionLabel?: string) => void
}

// ── Answer card ───────────────────────────────────────────────────────────────

function Citation({ resourceId: _id, ...c }: { resourceId: number; title: string; url: string | null; suspect: boolean }): JSX.Element {
  return (
    <button
      type="button"
      className={styles.citation}
      onClick={() => c.url && openExternal(c.url)}
      disabled={c.url === null}
      title={c.url ?? 'No link'}
    >
      <Icon icon={ExternalLink} size={12} />
      <span className={styles.citationTitle}>{c.title}</span>
      {c.suspect && <span className={styles.suspectDot} title="This source last failed — re-verify" />}
    </button>
  )
}

function AnswerCard({ result, onDismiss }: { result: ResolveResult; onDismiss: () => void }): JSX.Element {
  return (
    <div className={styles.answerCard}>
      <button type="button" className={styles.answerClose} onClick={onDismiss} aria-label="Dismiss answer">
        <Icon icon={X} size={13} />
      </button>

      {result.verdict === 'confident' && (
        <>
          <div className={styles.liveValue}>{result.liveValue}</div>
          {result.citation && <Citation {...result.citation} />}
        </>
      )}

      {result.verdict === 'source_available_no_live_value' && (
        <>
          <div className={styles.answerText}>{result.answer}</div>
          {result.citation && <Citation {...result.citation} />}
        </>
      )}

      {result.verdict === 'clarify' && (
        <>
          <div className={styles.clarifyRow}>
            <Icon icon={CircleHelp} size={14} className={styles.clarifyIcon} />
            <span className={styles.answerText}>{result.answer}</span>
          </div>
          {result.candidates.length > 0 && (
            <div className={styles.candidateChips}>
              {result.candidates.map((c) => (
                <Citation key={c.resourceId} {...c} />
              ))}
            </div>
          )}
        </>
      )}

      {result.verdict === 'none' && (
        <div className={`${styles.answerText} ${styles.muted}`}>{result.answer}</div>
      )}
    </div>
  )
}

// ── Capture proposal card ─────────────────────────────────────────────────────

function ProposalCard({
  proposal,
  onAccept,
  onCancel,
}: {
  proposal: CaptureProposal
  onAccept: (title: string) => void
  onCancel: () => void
}): JSX.Element {
  const [title, setTitle] = useState(proposal.title)
  return (
    <div className={styles.proposalCard}>
      <div className={styles.proposalHead}>
        <span className={styles.badge}>{proposal.source}</span>
        <span className={styles.badge}>{proposal.kind}</span>
        {proposal.service && <span className={styles.badgeMuted}>{proposal.service}</span>}
        {proposal.env && <span className={styles.badgeMuted}>{proposal.env}</span>}
      </div>
      <input
        className={styles.proposalTitle}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        autoFocus
      />
      <div className={styles.proposalActions}>
        <button type="button" className={styles.acceptBtn} onClick={() => onAccept(title)}>
          <Icon icon={CircleCheck} size={13} /> Save resource
        </button>
        <button type="button" className={styles.cancelBtn} onClick={onCancel}>
          Discard
        </button>
      </div>
    </div>
  )
}

// ── Browse groups ─────────────────────────────────────────────────────────────

function ResourceRow({
  resource,
  onOpen,
  onDelete,
}: {
  resource: Resource
  onOpen: (r: Resource) => void
  onDelete: (r: Resource) => void
}): JSX.Element {
  const hasLink = resource.url !== null
  return (
    <div className={styles.browseRow}>
      <button
        type="button"
        className={styles.browseMain}
        onClick={() => onOpen(resource)}
        disabled={!hasLink}
        title={hasLink ? resource.url ?? undefined : 'Live query source — no link to open'}
      >
        <Icon icon={Database} size={14} className={styles.browseIcon} />
        <span className={styles.browseTitle}>{resource.title}</span>
        {resource.suspect && (
          <span className={styles.suspectBadge} title={resource.lastErrorMessage ?? 'Last lookup failed'}>
            <Icon icon={TriangleAlert} size={11} /> suspect
          </span>
        )}
      </button>
      <button type="button" className={styles.rowAction} onClick={() => onDelete(resource)} aria-label="Delete resource">
        <Icon icon={Trash2} size={13} />
      </button>
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function ResourcePanel({ projectId, showUndo }: ResourcePanelProps): JSX.Element {
  const [groups, setGroups] = useState<ResourceGroup[]>([])
  const [question, setQuestion] = useState('')
  const [resolving, setResolving] = useState(false)
  const [answer, setAnswer] = useState<ResolveResult | null>(null)
  const [captureUrl, setCaptureUrl] = useState('')
  const [proposal, setProposal] = useState<CaptureProposal | null>(null)

  useEffect(() => {
    let active = true
    const load = async (): Promise<void> => {
      try {
        const g = await window.electron.ipc.invoke('resources:groups', projectId)
        if (active) setGroups(g)
      } catch (err) {
        console.error('[Resources] load failed:', err)
      }
    }
    void load()
    const unsub = window.electron.onResourcesUpdated(() => { void load() })
    return () => {
      active = false
      unsub()
    }
  }, [projectId])

  const ask = async (): Promise<void> => {
    const q = question.trim()
    if (q.length === 0 || resolving) return
    setResolving(true)
    setAnswer(null)
    try {
      const result = await window.electron.ipc.invoke('resources:resolve', projectId, q)
      setAnswer(result)
    } catch (err) {
      console.error('[Resources] resolve failed:', err)
      setAnswer({
        verdict: 'none',
        answer: "I couldn't resolve that just now.",
        citation: null,
        liveValue: null,
        clarifyQuestion: null,
        candidates: [],
        failureClass: 'connector_down',
      })
    } finally {
      setResolving(false)
    }
  }

  const fetchProposal = async (): Promise<void> => {
    const url = captureUrl.trim()
    if (url.length === 0) return
    try {
      const p = await window.electron.ipc.invoke('resources:capture-proposal', url)
      setProposal(p)
    } catch (err) {
      console.error('[Resources] capture proposal failed:', err)
    }
  }

  const acceptProposal = (title: string): void => {
    if (proposal === null) return
    const p = proposal
    const save = async (): Promise<void> => {
      const created = await window.electron.ipc.invoke('resources:create', projectId, {
        title: title.trim().length > 0 ? title.trim() : p.title,
        kind: p.kind,
        source: p.source,
        service: p.service,
        env: p.env,
        url: p.url,
        externalRef: p.externalRef,
        tags: p.tags,
        provenance: 'captured',
      })
      showUndo('Resource saved', () => fire(window.electron.ipc.invoke('resources:delete', created.id)))
    }
    fire(save(), 'resources:create')
    setProposal(null)
    setCaptureUrl('')
  }

  const openResource = (r: Resource): void => {
    if (r.url) openExternal(r.url)
  }

  const deleteResource = (r: Resource): void => {
    fire(window.electron.ipc.invoke('resources:delete', r.id))
    showUndo('Resource removed', () => fire(window.electron.ipc.invoke('resources:restore', r.id)))
  }

  const hasResources = groups.some((g) => g.resources.length > 0)

  return (
    <div className={styles.panel}>
      {/* Ask box — the primary thing */}
      <div className={styles.askRow}>
        <Icon icon={Search} size={15} className={styles.askIcon} />
        <input
          className={styles.askInput}
          value={question}
          placeholder="Ask about this project…"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void ask()}
        />
        {resolving && <span className={styles.resolving}>Resolving…</span>}
      </div>

      {answer && <AnswerCard result={answer} onDismiss={() => setAnswer(null)} />}

      {/* Capture */}
      <div className={styles.captureRow}>
        <input
          className={styles.captureInput}
          value={captureUrl}
          placeholder="Paste a dashboard, query, or doc link…"
          onChange={(e) => setCaptureUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void fetchProposal()}
        />
        <button type="button" className={styles.captureBtn} onClick={() => void fetchProposal()} aria-label="Capture link">
          <Icon icon={Plus} size={15} />
        </button>
      </div>

      {proposal && (
        <ProposalCard proposal={proposal} onAccept={acceptProposal} onCancel={() => setProposal(null)} />
      )}

      {/* Browse */}
      {hasResources ? (
        <div className={styles.browse}>
          {groups.map((group) => (
            <div key={group.key} className={styles.group}>
              <div className={styles.groupLabel}>{group.label}</div>
              {group.resources.map((r) => (
                <ResourceRow key={r.id} resource={r} onOpen={openResource} onDelete={deleteResource} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          Nothing saved yet. Ask a question above, or paste a dashboard/query/doc link to capture one.
        </div>
      )}
    </div>
  )
}
