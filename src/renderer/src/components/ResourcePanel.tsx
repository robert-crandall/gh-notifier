import { useEffect, useState } from 'react'
import {
  Search,
  ExternalLink,
  Trash2,
  Plus,
  X,
  CircleCheck,
  Database,
  Zap,
} from 'lucide-react'
import type {
  CaptureProposal,
  RecommendationResult,
  Resource,
  ResourceGroup,
} from '@shared/ipc-channels'
import { Icon } from './Icon'
import { LinkifiedText } from './LinkifiedText'
import { fire, openExternal } from '../ipc'
import styles from './ResourcePanel.module.css'

interface ResourcePanelProps {
  projectId: number
  showUndo: (message: string, onUndo: () => void, actionLabel?: string) => void
}

// ── Citation ──────────────────────────────────────────────────────────────────

function Citation({ resourceId: _id, ...c }: { resourceId: number; title: string; url: string | null }): JSX.Element {
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
    </button>
  )
}

// ── Recommendation card (#88) ─────────────────────────────────────────────────

function RecommendationCard({ result, onDismiss }: { result: RecommendationResult; onDismiss: () => void }): JSX.Element {
  return (
    <div className={styles.answerCard}>
      <button type="button" className={styles.answerClose} onClick={onDismiss} aria-label="Dismiss recommendations">
        <Icon icon={X} size={13} />
      </button>

      <div className={`${styles.answerText} ${result.items.length === 0 ? styles.muted : ''}`}><LinkifiedText text={result.summary} /></div>

      {result.items.length > 0 && (
        <ul className={styles.recommendList}>
          {result.items.map((it) => (
            <li key={it.citation.resourceId} className={styles.recommendItem}>
              <Citation {...it.citation} />
              <span className={styles.recommendWhy}>{it.why}</span>
            </li>
          ))}
        </ul>
      )}

      {result.retrievalMode === 'lexical-fallback' && (
        <div
          className={styles.fallbackNote}
          title="The local semantic model wasn't available, so this used keyword-only matching. Results may be less relevant."
        >
          <span className={styles.fallbackDot} />
          Keyword-only matching (semantic model unavailable)
        </div>
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
        title={hasLink ? resource.url ?? undefined : 'No link to open'}
      >
        <Icon icon={Database} size={14} className={styles.browseIcon} />
        <span className={styles.browseTitle}>{resource.title}</span>
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
  const [recommending, setRecommending] = useState(false)
  const [recommendation, setRecommendation] = useState<RecommendationResult | null>(null)
  const [captureUrl, setCaptureUrl] = useState('')
  const [proposal, setProposal] = useState<CaptureProposal | null>(null)

  useEffect(() => {
    let active = true
    const load = async (): Promise<void> => {
      try {
        const g = await window.electron.ipc.invoke('resources:groups', projectId)
        if (active) setGroups(g)
      } catch (err) {
        console.error('[Resources] groups load failed:', err)
      }
    }
    void load()
    const unsub = window.electron.onResourcesUpdated(() => { void load() })
    return () => {
      active = false
      unsub()
    }
  }, [projectId])

  const recommend = async (): Promise<void> => {
    const q = question.trim()
    if (q.length === 0 || recommending) return
    setRecommending(true)
    setRecommendation(null)
    try {
      const result = await window.electron.ipc.invoke('resources:recommend', projectId, q)
      setRecommendation(result)
    } catch (err) {
      console.error('[Resources] recommend failed:', err)
      setRecommendation({
        items: [],
        summary: "I couldn't rank saved sources just now.",
        failureClass: 'connector_down',
        // The IPC call itself failed, so no retrieval ran; report the configured
        // (semantic) path rather than 'lexical', which would imply a lexical
        // retriever was wired and mislead logs/telemetry.
        retrievalMode: 'semantic',
      })
    } finally {
      setRecommending(false)
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
      // Only clear the proposal/URL once the create actually succeeded, so a
      // failure doesn't silently discard what the user pasted/edited.
      setProposal(null)
      setCaptureUrl('')
      showUndo('Resource saved', () => fire(window.electron.ipc.invoke('resources:delete', created.id)))
    }
    fire(save(), 'resources:create')
  }

  const openResource = (r: Resource): void => {
    if (r.url) openExternal(r.url)
  }

  const deleteResource = (r: Resource): void => {
    // Await the delete before claiming success — otherwise a failed delete would
    // still show an undo toast for a record that's actually still present.
    const run = async (): Promise<void> => {
      await window.electron.ipc.invoke('resources:delete', r.id)
      showUndo('Resource removed', () => fire(window.electron.ipc.invoke('resources:restore', r.id)))
    }
    fire(run(), 'resources:delete')
  }

  const hasResources = groups.some((g) => g.resources.length > 0)

  return (
    <div className={styles.panel}>
      {/* Ask box — find relevant saved sources (read-only, from saved metadata) */}
      <div className={styles.askRow}>
        <Icon icon={Search} size={15} className={styles.askIcon} />
        <input
          className={styles.askInput}
          value={question}
          placeholder="Find saved sources relevant to this project…"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void recommend()}
        />
        {recommending && <span className={styles.resolving}>Ranking…</span>}
        <button
          type="button"
          className={styles.relevantBtn}
          onClick={() => void recommend()}
          disabled={question.trim().length === 0 || recommending}
          title="Suggest saved sources relevant to this — read-only, from saved metadata"
        >
          <Icon icon={Zap} size={13} />
          What’s relevant?
        </button>
      </div>

      {recommendation && <RecommendationCard result={recommendation} onDismiss={() => setRecommendation(null)} />}

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
                <ResourceRow
                  key={r.id}
                  resource={r}
                  onOpen={openResource}
                  onDelete={deleteResource}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          Nothing saved yet. Paste a dashboard/query/doc link to capture one, or search for relevant saved sources above.
        </div>
      )}
    </div>
  )
}
