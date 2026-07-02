import { History, X, GitPullRequest, Sparkles, CircleCheck, CirclePause, Bell, Eye } from 'lucide-react'
import type { DigestItem, DigestItemKind, ReentryDigest } from '@shared/ipc-channels'
import { Icon } from './Icon'
import type { LucideIcon } from 'lucide-react'
import styles from './ReentryDigest.module.css'

interface ReentryDigestProps {
  digest: ReentryDigest
  onDismiss: () => void
}

const KIND_ICON: Record<DigestItemKind, LucideIcon> = {
  'agent-pr-ready': GitPullRequest,
  'agent-waiting': CirclePause,
  'agent-completed': CircleCheck,
  'agent-in-progress': Sparkles,
  'notification-review': Eye,
  'notification-activity': Bell,
  'notifications-grouped': Bell,
}

function openHref(href: string): void {
  void window.electron.openExternal(href)
}

function DigestRow({ item }: { item: DigestItem }): JSX.Element {
  const content = (
    <>
      <Icon icon={KIND_ICON[item.kind]} size={14} className={styles[`tone_${item.tone}`]} />
      <span>{item.text}</span>
    </>
  )
  if (item.href) {
    return (
      <button type="button" className={`${styles.row} ${styles.rowLink}`} onClick={() => openHref(item.href as string)}>
        {content}
      </button>
    )
  }
  return <div className={styles.row}>{content}</div>
}

export function ReentryDigest({ digest, onDismiss }: ReentryDigestProps): JSX.Element | null {
  if (digest.items.length === 0) return null
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <span className={styles.title}>
          <Icon icon={History} size={15} className={styles.titleIcon} />
          Since you were here
        </span>
        <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss digest">
          <Icon icon={X} size={15} />
        </button>
      </div>
      <div className={styles.items}>
        {digest.items.map((item) => (
          <DigestRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}
