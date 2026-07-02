import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Icon } from '../components/Icon'
import { useAuth } from '../hooks/useAuth'
import {
  type Accent,
  type ColorMode,
  type Density,
  type UseThemeResult,
  ACCENTS,
  COLOR_MODES,
  DENSITIES,
} from '../hooks/useTheme'
import {
  SYNC_INTERVAL_OPTIONS,
  MAX_SYNC_DAYS_OPTIONS,
  type SyncIntervalMinutes,
  type MaxSyncDays,
} from '@shared/ipc-channels'
import styles from './SettingsView.module.css'

interface SettingsViewProps {
  theme: UseThemeResult
  onClose: () => void
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
          className={`${styles.segment} ${value === opt ? styles.segmentActive : ''}`}
          onClick={() => onChange(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

export function SettingsView({ theme, onClose }: SettingsViewProps): JSX.Element {
  const auth = useAuth()
  const [token, setToken] = useState('')
  const [syncInterval, setSyncInterval] = useState<SyncIntervalMinutes | null>(null)
  const [maxDays, setMaxDays] = useState<MaxSyncDays | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [interval, days] = await Promise.all([
          window.electron.ipc.invoke('settings:get-sync-interval'),
          window.electron.ipc.invoke('settings:get-max-sync-days'),
        ])
        setSyncInterval(interval)
        setMaxDays(days)
      } catch (err) {
        console.error('[Settings] load failed:', err)
      }
    })()
  }, [])

  const changeInterval = (value: SyncIntervalMinutes): void => {
    setSyncInterval(value)
    void window.electron.ipc.invoke('settings:set-sync-interval', value)
  }
  const changeMaxDays = (value: MaxSyncDays): void => {
    setMaxDays(value)
    void window.electron.ipc.invoke('settings:set-max-sync-days', value)
  }

  return (
    <main className={styles.main}>
      <header className={styles.toolbar}>
        <button className={styles.back} onClick={onClose} aria-label="Back to focus">
          <Icon icon={ArrowLeft} size={16} />
        </button>
        <span className={styles.title}>Settings</span>
      </header>

      <div className={styles.content}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Appearance</h2>
          <div className={styles.field}>
            <span className={styles.label}>Color mode</span>
            <Segmented<ColorMode> options={COLOR_MODES} value={theme.colorMode} onChange={theme.setColorMode} />
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Accent</span>
            <div className={styles.accents}>
              {ACCENTS.map((a: Accent) => (
                <button
                  key={a}
                  className={`${styles.accentSwatch} ${styles[`accent_${a}`]} ${theme.accent === a ? styles.accentActive : ''}`}
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
              <button className={styles.secondaryButton} onClick={() => void auth.logout()}>Sign out</button>
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
                  onChange={(e) => setToken(e.target.value)}
                />
                <button
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
              onChange={(e) => changeInterval(Number(e.target.value) as SyncIntervalMinutes)}
            >
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
              onChange={(e) => changeMaxDays(Number(e.target.value) as MaxSyncDays)}
            >
              {MAX_SYNC_DAYS_OPTIONS.map((d) => (
                <option key={d} value={d}>{d} days</option>
              ))}
            </select>
          </div>
        </section>
      </div>
    </main>
  )
}
