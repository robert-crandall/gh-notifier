import { useCallback, useEffect, useState } from 'react'
import { BookOpen, FolderOpen, AlertTriangle } from 'lucide-react'
import type { ProjectCard, ServiceRunbook } from '@shared/ipc-channels'
import { normalizeServiceName } from '@shared/service-name'
import { Icon } from './Icon'
import { LinkifiedText } from './LinkifiedText'
import { ServicesEditor } from './ServicesEditor'
import { fire } from '../ipc'
import styles from './RunbooksPanel.module.css'

interface RunbooksPanelProps {
  projectId: number
}

function metaLine(rb: ServiceRunbook): string {
  const parts: string[] = []
  if (rb.env !== null && rb.env.length > 0) parts.push(rb.env)
  if (rb.source !== null && rb.source.length > 0) parts.push(`source: ${rb.source}`)
  if (rb.updatedAt !== null && rb.updatedAt.length > 0) parts.push(`updated ${rb.updatedAt}`)
  return parts.join(' · ')
}

function RunbookCard({ rb }: { rb: ServiceRunbook }): JSX.Element {
  const reveal = (): void => {
    fire(window.electron.ipc.invoke('knowledge:reveal', rb.service), 'knowledge:reveal')
  }
  const meta = rb.status === 'ok' ? metaLine(rb) : ''
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <Icon icon={BookOpen} size={14} className={styles.cardIcon} />
        <span className={styles.cardTitle}>{rb.service}</span>
        {rb.status === 'ok' && (
          <button type="button" className={styles.revealBtn} onClick={reveal} title="Reveal file in Finder">
            <Icon icon={FolderOpen} size={12} /> Reveal
          </button>
        )}
      </div>

      {rb.status === 'ok' && (
        <>
          {meta.length > 0 && <div className={styles.meta}>{meta}</div>}
          <pre className={styles.body}>
            <LinkifiedText text={rb.markdown ?? ''} />
          </pre>
        </>
      )}

      {rb.status === 'missing' && (
        <div className={styles.muted}>No runbook yet. Ask Copilot to write one, or create <code>{rb.key}.md</code> on disk.</div>
      )}

      {(rb.status === 'invalid' || rb.status === 'blocked' || rb.status === 'too_large') && (
        <div className={styles.warn}>
          <Icon icon={AlertTriangle} size={13} className={styles.warnIcon} />
          <span>{rb.reason ?? 'Runbook unavailable.'}</span>
        </div>
      )}
    </div>
  )
}

export function RunbooksPanel({ projectId }: RunbooksPanelProps): JSX.Element {
  const [card, setCard] = useState<ProjectCard | null>(null)
  const [runbooks, setRunbooks] = useState<ServiceRunbook[]>([])
  const [loaded, setLoaded] = useState(false)
  const [cardError, setCardError] = useState(false)
  const [runbooksError, setRunbooksError] = useState(false)
  const [saving, setSaving] = useState(false)

  // Load the card and the runbook list independently: a transient runbook read failure must
  // not hide the services editor when the card loaded fine (and vice versa).
  const load = useCallback(async (): Promise<void> => {
    const [cardResult, runbooksResult] = await Promise.allSettled([
      window.electron.ipc.invoke('resources:card-get', projectId),
      window.electron.ipc.invoke('knowledge:list-for-project', projectId),
    ])
    if (cardResult.status === 'fulfilled') {
      setCard(cardResult.value ?? null)
      setCardError(false)
    } else {
      console.error('[Runbooks] card load failed:', cardResult.reason)
      setCardError(true)
    }
    if (runbooksResult.status === 'fulfilled') {
      setRunbooks(runbooksResult.value)
      setRunbooksError(false)
    } else {
      console.error('[Runbooks] runbook load failed:', runbooksResult.reason)
      setRunbooksError(true)
    }
  }, [projectId])

  useEffect(() => {
    let active = true
    const run = async (): Promise<void> => {
      await load()
      if (active) setLoaded(true)
    }
    void run()
    // card-upsert fires no event, so this only reloads on out-of-band MCP knowledge writes;
    // in-app card edits reload directly via the add/remove handlers below.
    const unsub = window.electron.onKnowledgeUpdated(() => { void load() })
    return () => {
      active = false
      unsub()
    }
  }, [load])

  // Persist a new services array, then reload so runbooks appear/disappear live. The `saving`
  // guard drops overlapping mutations so a stale services array can't clobber a newer one.
  const persistServices = useCallback(
    async (services: string[]): Promise<void> => {
      if (saving) return
      setSaving(true)
      try {
        const updated = await window.electron.ipc.invoke('resources:card-upsert', projectId, { services })
        setCard(updated ?? null)
        await load()
      } catch (err) {
        console.error('[Runbooks] card-upsert failed:', err)
      } finally {
        setSaving(false)
      }
    },
    [projectId, saving, load]
  )

  const addService = useCallback(
    (key: string): void => {
      if (card === null) return
      if (card.services.some((s) => normalizeServiceName(s) === key)) return
      fire(persistServices([...card.services, key]), 'resources:card-upsert')
    },
    [card, persistServices]
  )

  const removeService = useCallback(
    (key: string): void => {
      if (card === null) return
      const next = card.services.filter((s) => normalizeServiceName(s) !== key)
      if (next.length === card.services.length) return
      fire(persistServices(next), 'resources:card-upsert')
    },
    [card, persistServices]
  )

  if (loaded && cardError) {
    return <div className={styles.empty}>Couldn’t load this project’s card. Try again in a moment.</div>
  }

  return (
    <div className={styles.panel}>
      {card !== null && (
        <ServicesEditor services={card.services} onAdd={addService} onRemove={removeService} busy={saving} />
      )}

      {loaded && runbooksError && (
        <div className={styles.empty}>Couldn’t load runbooks for this project. Try again in a moment.</div>
      )}

      {loaded && !runbooksError && runbooks.length === 0 && (
        <div className={styles.empty}>
          No services on this project yet. Add one above and Copilot can keep a per-service runbook (how to check
          health, monitor links, oncall notes).
        </div>
      )}

      {runbooks.map((rb) => (
        <RunbookCard key={rb.key ?? `invalid:${rb.service}`} rb={rb} />
      ))}
    </div>
  )
}
