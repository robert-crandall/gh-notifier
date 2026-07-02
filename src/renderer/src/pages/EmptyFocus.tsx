import { Target, Plus } from 'lucide-react'
import { Icon } from '../components/Icon'
import styles from './EmptyFocus.module.css'

interface EmptyFocusProps {
  onNewProject: () => void
}

export function EmptyFocus({ onNewProject }: EmptyFocusProps): JSX.Element {
  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <Icon icon={Target} size={28} className={styles.icon} />
        <h1 className={styles.title}>Nothing in focus yet</h1>
        <p className={styles.body}>Create a project to give yourself one clear thing to work on.</p>
        <button className={styles.button} onClick={onNewProject}>
          <Icon icon={Plus} size={15} />
          New project
        </button>
      </div>
    </main>
  )
}
