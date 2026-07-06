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
  Zap,
  Unplug,
} from 'lucide-react'
import type {
  CaptureProposal,
  RecommendationResult,
  ResolveResult,
  Resource,
  ResourceGroup,
  McpServerSummary,
} from '@shared/ipc-channels'
import { Icon } from './Icon'
import { LinkifiedText } from './LinkifiedText'
import { fire, openExternal } from '../ipc'
import { McpServersSection, ConnectResourceDialog } from './McpTools'
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
          <div className={styles.liveValue}><LinkifiedText text={result.liveValue ?? ''} /></div>
          {result.citation && <Citation {...result.citation} />}
        </>
      )}

      {result.verdict === 'source_available_no_live_value' && (
        <>
          <div className={styles.answerText}><LinkifiedText text={result.answer} /></div>
          {result.citation && <Citation {...result.citation} />}
        </>
      )}

      {result.verdict === 'clarify' && (
        <>
          <div className={styles.clarifyRow}>
            <Icon icon={CircleHelp} size={14} className={styles.clarifyIcon} />
            <span className={styles.answerText}><LinkifiedText text={result.answer} /></span>
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
        <div className={`${styles.answerText} ${styles.muted}`}><LinkifiedText text={result.answer} /></div>
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
  serverLive,
  onOpen,
  onDelete,
  onConnect,
  onDisconnect,
}: {
  resource: Resource
  serverLive: boolean
  onOpen: (r: Resource) => void
  onDelete: (r: Resource) => void
  onConnect: (r: Resource) => void
  onDisconnect: (r: Resource) => void
}): JSX.Element {
  const hasLink = resource.url !== null
  // Match main's wiring semantics (resolve/validateToolName trim): blank or
  // whitespace-only server/tool is NOT wired.
  const hasWiring = (resource.mcpServer?.trim().length ?? 0) > 0 && (resource.toolName?.trim().length ?? 0) > 0
  const live = hasWiring && serverLive
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
        {live && (
          <span className={styles.liveBadge} title={`Live via ${resource.toolName}`}>
            <Icon icon={Zap} size={11} /> {resource.toolName}
          </span>
        )}
        {hasWiring && !serverLive && (
          <span className={styles.suspectBadge} title="The wired tool is disconnected — reconnect or clear it">
            <Icon icon={Unplug} size={11} /> connection missing
          </span>
        )}
        {resource.suspect && (
          <span className={styles.suspectBadge} title={resource.lastErrorMessage ?? 'Last lookup failed'}>
            <Icon icon={TriangleAlert} size={11} /> suspect
          </span>
        )}
      </button>
      {hasWiring ? (
        <button type="button" className={styles.rowAction} onClick={() => onDisconnect(resource)} title="Disconnect live value" aria-label="Disconnect live value">
          <Icon icon={Unplug} size={13} />
        </button>
      ) : (
        <button type="button" className={styles.rowAction} onClick={() => onConnect(resource)} title="Connect live value" aria-label="Connect live value">
          <Icon icon={Zap} size={13} />
        </button>
      )}
      <button type="button" className={styles.rowAction} onClick={() => onDelete(resource)} aria-label="Delete resource">
        <Icon icon={Trash2} size={13} />
      </button>
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function ResourcePanel({ projectId, showUndo }: ResourcePanelProps): JSX.Element {
  const [groups, setGroups] = useState<ResourceGroup[]>([])
  const [servers, setServers] = useState<McpServerSummary[]>([])
  const [question, setQuestion] = useState('')
  const [resolving, setResolving] = useState(false)
  const [answer, setAnswer] = useState<ResolveResult | null>(null)
  const [recommending, setRecommending] = useState(false)
  const [recommendation, setRecommendation] = useState<RecommendationResult | null>(null)
  const [captureUrl, setCaptureUrl] = useState('')
  const [proposal, setProposal] = useState<CaptureProposal | null>(null)
  const [connecting, setConnecting] = useState<Resource | null>(null)

  useEffect(() => {
    let active = true
    const load = async (): Promise<void> => {
      // Load independently so a transient mcp-list failure can't blank the
      // resources list (and vice versa).
      try {
        const g = await window.electron.ipc.invoke('resources:groups', projectId)
        if (active) setGroups(g)
      } catch (err) {
        console.error('[Resources] groups load failed:', err)
      }
      try {
        const s = await window.electron.ipc.invoke('resources:mcp-list', projectId)
        if (active) setServers(s)
      } catch (err) {
        console.error('[Resources] mcp-list load failed:', err)
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
    if (q.length === 0 || resolving || recommending) return
    setResolving(true)
    setAnswer(null)
    setRecommendation(null)
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
        // The IPC call itself failed, so no retrieval ran; report the configured
        // (semantic) path rather than 'lexical', which would imply a lexical
        // retriever was wired and mislead logs/telemetry.
        retrievalMode: 'semantic',
      })
    } finally {
      setResolving(false)
    }
  }

  const recommend = async (): Promise<void> => {
    const q = question.trim()
    if (q.length === 0 || recommending || resolving) return
    setRecommending(true)
    setRecommendation(null)
    setAnswer(null)
    try {
      const result = await window.electron.ipc.invoke('resources:recommend', projectId, q)
      setRecommendation(result)
    } catch (err) {
      console.error('[Resources] recommend failed:', err)
      setRecommendation({
        items: [],
        summary: "I couldn't rank saved sources just now.",
        failureClass: 'connector_down',
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

  const disconnectResource = (r: Resource): void => {
    const prevServer = r.mcpServer
    const prevTool = r.toolName
    const prevArgs = r.toolArgs
    const run = async (): Promise<void> => {
      await window.electron.ipc.invoke('resources:mcp-disconnect', r.id)
      showUndo('Disconnected live value', () => {
        if (prevServer !== null && prevTool !== null) {
          fire(
            window.electron.ipc.invoke('resources:mcp-connect', r.id, {
              serverId: prevServer,
              toolName: prevTool,
              toolArgs: prevArgs ?? {},
            }),
            'resources:mcp-connect'
          )
        }
      })
    }
    fire(run(), 'resources:mcp-disconnect')
  }

  const hasResources = groups.some((g) => g.resources.length > 0)
  const liveServerIds = new Set(servers.map((s) => s.id))

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
        {(resolving || recommending) && <span className={styles.resolving}>{recommending ? 'Ranking…' : 'Resolving…'}</span>}
        <button
          type="button"
          className={styles.relevantBtn}
          onClick={() => void recommend()}
          disabled={question.trim().length === 0 || recommending || resolving}
          title="Suggest saved sources relevant to this — read-only, from saved metadata"
        >
          <Icon icon={Zap} size={13} />
          What’s relevant?
        </button>
      </div>

      {answer && <AnswerCard result={answer} onDismiss={() => setAnswer(null)} />}
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
                  serverLive={r.mcpServer !== null && liveServerIds.has(r.mcpServer)}
                  onOpen={openResource}
                  onDelete={deleteResource}
                  onConnect={setConnecting}
                  onDisconnect={disconnectResource}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          Nothing saved yet. Ask a question above, or paste a dashboard/query/doc link to capture one.
        </div>
      )}

      {/* Tool management (per-project MCP servers) */}
      <McpServersSection projectId={projectId} servers={servers} showUndo={showUndo} />

      {connecting && (
        <ConnectResourceDialog
          projectId={projectId}
          resource={connecting}
          servers={servers}
          onClose={() => setConnecting(null)}
        />
      )}
    </div>
  )
}
