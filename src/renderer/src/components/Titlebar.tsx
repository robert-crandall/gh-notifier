import { Target, Search, Sun, Moon, Settings } from 'lucide-react'
import { Icon } from './Icon'
import type { ResolvedColorMode } from '../hooks/useTheme'
import styles from './Titlebar.module.css'

interface TitlebarProps {
  onOpenPalette: () => void
  colorMode: ResolvedColorMode
  onToggleColorMode: () => void
  onOpenSettings: () => void
}

export function Titlebar({ onOpenPalette, colorMode, onToggleColorMode, onOpenSettings }: TitlebarProps): JSX.Element {
  return (
    <div className={styles.bar}>
      <div className={styles.brand}>
        <Icon icon={Target} size={14} className={styles.brandIcon} />
        <span>Focus</span>
      </div>

      <div className={styles.searchWrap}>
        <button type="button" className={styles.search} onClick={onOpenPalette} aria-label="Open command palette">
          <Icon icon={Search} size={14} />
          <span className={styles.searchText}>Jump to a project, or run a command…</span>
          <kbd className={styles.kbd}>⌘K</kbd>
        </button>
      </div>

      <div className={styles.actions}>
        <button type="button"
          className={styles.iconButton}
          onClick={onToggleColorMode}
          aria-label={colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <Icon icon={colorMode === 'dark' ? Sun : Moon} size={15} />
        </button>
        <button type="button" className={styles.iconButton} onClick={onOpenSettings} aria-label="Settings">
          <Icon icon={Settings} size={15} />
        </button>
        <span className={styles.avatar} aria-hidden />
      </div>
    </div>
  )
}
