import type { CopilotAppSession, CopilotAppSessionStatus } from '@shared/ipc-channels'
import { Sparkles } from 'lucide-react'
import { Icon } from './Icon'
import { fire } from '../ipc'
import styles from './TodoSessionChip.module.css'

/**
 * A small chip on a todo showing the status of the Copilot desktop-app session
 * it was delegated to (#87). Clicking opens that session in the app. Copy is
 * deliberately honest: is_running=0 is "idle", not "needs you"; an unreadable
 * status ("unknown") stays neutral. Only sessions Focus created reach here.
 */

const LABEL: Record<CopilotAppSessionStatus, string> = {
  in_progress: 'Copilot working on this',
  waiting: 'Copilot idle',
  completed: 'Copilot session',
  unknown: 'Copilot session',
}

export function TodoSessionChip({ session }: { session: CopilotAppSession }): JSX.Element {
  const open = (): void => {
    fire(window.electron.ipc.invoke('copilot:open-app-session', session.id), 'copilot:open-app-session')
  }
  return (
    <button
      type="button"
      className={`${styles.chip} ${styles[session.status]}`}
      onClick={open}
      title="Open this session in the Copilot app"
    >
      <span className={styles.dot} aria-hidden />
      <Icon icon={Sparkles} size={11} className={styles.icon} />
      <span className={styles.label}>{LABEL[session.status]}</span>
      <span className={styles.arrow} aria-hidden>→</span>
    </button>
  )
}
