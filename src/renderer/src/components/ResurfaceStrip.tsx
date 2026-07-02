import { Compass, Moon, Clock, X } from 'lucide-react'
import type { Project } from '@shared/ipc-channels'
import { Icon } from './Icon'
import styles from './ResurfaceStrip.module.css'

interface ResurfaceStripProps {
  /** Drifting projects (already excludes the focused one), stalest first. */
  drifting: Project[]
  onSelect: (id: number) => void
  onPark: (project: Project) => void
  onSnooze: (project: Project) => void
  onNotNow: (project: Project) => void
}

const MAX_SHOWN = 3

export function ResurfaceStrip({ drifting, onSelect, onPark, onSnooze, onNotNow }: ResurfaceStripProps): JSX.Element | null {
  if (drifting.length === 0) return null
  const shown = drifting.slice(0, MAX_SHOWN)

  return (
    <section className={styles.strip}>
      <div className={styles.head}>
        <Icon icon={Compass} size={15} className={styles.headIcon} />
        <span className={styles.title}>Threads you left open</span>
        <span className={styles.sub}>still want these warm?</span>
      </div>
      <div className={styles.rows}>
        {shown.map((p) => (
          <div key={p.id} className={styles.row}>
            <button className={styles.name} onClick={() => onSelect(p.id)}>
              {p.name}
            </button>
            <div className={styles.actions}>
              <button className={styles.action} onClick={() => onPark(p)}>
                <Icon icon={Moon} size={13} />
                Park
              </button>
              <button className={styles.action} onClick={() => onSnooze(p)}>
                <Icon icon={Clock} size={13} />
                Snooze
              </button>
              <button className={styles.action} onClick={() => onNotNow(p)}>
                <Icon icon={X} size={13} />
                Not now
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
