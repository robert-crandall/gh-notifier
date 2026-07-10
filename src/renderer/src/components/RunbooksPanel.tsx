import { useEffect, useState } from 'react'
import { BookOpen, FolderOpen, AlertTriangle } from 'lucide-react'
import type { ServiceRunbook } from '@shared/ipc-channels'
import { Icon } from './Icon'
import { LinkifiedText } from './LinkifiedText'
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
          {metaLine(rb).length > 0 && <div className={styles.meta}>{metaLine(rb)}</div>}
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
  const [runbooks, setRunbooks] = useState<ServiceRunbook[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    const load = async (): Promise<void> => {
      try {
        const list = await window.electron.ipc.invoke('knowledge:list-for-project', projectId)
        if (active) {
          setRunbooks(list)
          setLoaded(true)
        }
      } catch (err) {
        console.error('[Runbooks] load failed:', err)
        if (active) setLoaded(true)
      }
    }
    void load()
    const unsub = window.electron.onKnowledgeUpdated(() => { void load() })
    return () => {
      active = false
      unsub()
    }
  }, [projectId])

  if (loaded && runbooks.length === 0) {
    return (
      <div className={styles.empty}>
        This project lists no services yet. Add services to the project card, then Copilot can keep a per-service
        runbook (how to check health, monitor links, oncall notes).
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      {runbooks.map((rb) => (
        <RunbookCard key={rb.key ?? `invalid:${rb.service}`} rb={rb} />
      ))}
    </div>
  )
}
