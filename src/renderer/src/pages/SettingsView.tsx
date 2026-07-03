import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { Icon } from '../components/Icon'
import { useAuth } from '../hooks/useAuth'
import {
  type Accent,
  type ColorMode,
  type Density,
  type UseThemeResult,
  ACCENTS,
  COLOR_MODES,
  COLOR_MODE_LABELS,
  DENSITIES,
} from '../hooks/useTheme'
import {
  SYNC_INTERVAL_OPTIONS,
  MAX_SYNC_DAYS_OPTIONS,
  type SyncIntervalMinutes,
  type MaxSyncDays,
} from '@shared/ipc-channels'
import { fire } from '../ipc'
import styles from './SettingsView.module.css'

interface SettingsViewProps {
  theme: UseThemeResult
  onClose: () => void
  onOpenRules: () => void
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div className={styles.segmented}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          aria-pressed={value === opt}
          className={`${styles.segment} ${value === opt ? styles.segmentActive : ''}`}
          onClick={() => onChange(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

export function SettingsView({ theme, onClose, onOpenRules }: SettingsViewProps): JSX.Element {
  const auth = useAuth()
  const [token, setToken] = useState('')
  const [syncInterval, setSyncInterval] = useState<SyncIntervalMinutes | null>(null)
  const [maxDays, setMaxDays] = useState<MaxSyncDays | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [interval, days] = await Promise.all([
          window.electron.ipc.invoke('settings:get-sync-interval'),
          window.electron.ipc.invoke('settings:get-max-sync-days'),
        ])
        if (!active) return
        setSyncInterval(interval)
        setMaxDays(days)
      } catch (err) {
        console.error('[Settings] load failed:', err)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const changeInterval = (value: SyncIntervalMinutes): void => {
    setSyncInterval(value)
    fire(window.electron.ipc.invoke('settings:set-sync-interval', value), 'settings:set-sync-interval')
  }
  const changeMaxDays = (value: MaxSyncDays): void => {
    setMaxDays(value)
    fire(window.electron.ipc.invoke('settings:set-max-sync-days', value), 'settings:set-max-sync-days')
  }

  return (
    <main className={styles.main}>
      <header className={styles.toolbar}>
        <button type="button" className={styles.back} onClick={onClose} aria-label="Back to focus">
          <Icon icon={ArrowLeft} size={16} />
        </button>
        <span className={styles.title}>Settings</span>
      </header>

      <div className={styles.content}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Appearance</h2>
          <div className={styles.field}>
            <span className={styles.label}>Color mode</span>
            <select
              className={styles.select}
              value={theme.colorMode}
              onChange={(e) => theme.setColorMode(e.target.value as ColorMode)}
              aria-label="Color mode"
            >
              {COLOR_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {COLOR_MODE_LABELS[mode]}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Accent</span>
            <div className={styles.accents}>
              {ACCENTS.map((a: Accent) => (
                <button
                  key={a}
                  type="button" className={`${styles.accentSwatch} ${styles[`accent_${a}`]} ${theme.accent === a ? styles.accentActive : ''}`}
                  onClick={() => theme.setAccent(a)}
                  aria-label={a}
                  title={a}
                />
              ))}
            </div>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Density</span>
            <Segmented<Density> options={DENSITIES} value={theme.density} onChange={theme.setDensity} />
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>GitHub</h2>
          {auth.status?.authenticated ? (
            <div className={styles.authRow}>
              <img className={styles.avatar} src={auth.status.avatarUrl} alt="" />
              <span className={styles.authName}>{auth.status.login}</span>
              <button type="button" className={styles.secondaryButton} onClick={() => void auth.logout()}>Sign out</button>
            </div>
          ) : (
            <div className={styles.field}>
              <span className={styles.label}>Personal access token</span>
              <div className={styles.tokenRow}>
                <input
                  className={styles.tokenInput}
                  type="password"
                  value={token}
                  placeholder="ghp_…"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(e) => setToken(e.target.value)}
                />
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={token.trim().length === 0 || auth.isLoading}
                  onClick={() => void auth.savePat(token.trim())}
                >
                  Connect
                </button>
              </div>
              {auth.error && <span className={styles.error}>{auth.error}</span>}
            </div>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Notifications</h2>
          <div className={styles.field}>
            <span className={styles.label}>Sync interval</span>
            <select
              className={styles.select}
              value={syncInterval ?? ''}
              disabled={syncInterval === null}
              onChange={(e) => {
                if (e.target.value) changeInterval(Number(e.target.value) as SyncIntervalMinutes)
              }}
            >
              {syncInterval === null && (
                <option value="" disabled>
                  Loading…
                </option>
              )}
              {SYNC_INTERVAL_OPTIONS.map((m) => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Look-back window</span>
            <select
              className={styles.select}
              value={maxDays ?? ''}
              disabled={maxDays === null}
              onChange={(e) => {
                if (e.target.value) changeMaxDays(Number(e.target.value) as MaxSyncDays)
              }}
            >
              {maxDays === null && (
                <option value="" disabled>
                  Loading…
                </option>
              )}
              {MAX_SYNC_DAYS_OPTIONS.map((d) => (
                <option key={d} value={d}>{d} days</option>
              ))}
            </select>
          </div>
          <button type="button" className={styles.linkRow} onClick={onOpenRules}>
            <span className={styles.label}>Notification rules</span>
            <span className={styles.linkRowValue}>
              Route &amp; filter
              <Icon icon={ChevronRight} size={16} />
            </span>
          </button>
        </section>
      </div>
    </main>
  )
}
