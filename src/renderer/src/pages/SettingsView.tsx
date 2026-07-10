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
  DEFAULT_REPOS_ROOT,
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
  const [appDelegate, setAppDelegate] = useState<boolean | null>(null)
  const [appObserve, setAppObserve] = useState<boolean | null>(null)
  const [reposRoot, setReposRoot] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [interval, days, delegate, observe, root] = await Promise.all([
          window.electron.ipc.invoke('settings:get-sync-interval'),
          window.electron.ipc.invoke('settings:get-max-sync-days'),
          window.electron.ipc.invoke('settings:get-app-delegate-enabled'),
          window.electron.ipc.invoke('settings:get-app-observe-enabled'),
          window.electron.ipc.invoke('settings:get-repos-root'),
        ])
        if (!active) return
        setSyncInterval(interval)
        setMaxDays(days)
        setAppDelegate(delegate)
        setAppObserve(observe)
        setReposRoot(root)
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
  const changeAppDelegate = (value: boolean): void => {
    setAppDelegate(value)
    fire(window.electron.ipc.invoke('settings:set-app-delegate-enabled', value), 'settings:set-app-delegate-enabled')
  }
  const changeAppObserve = (value: boolean): void => {
    setAppObserve(value)
    fire(window.electron.ipc.invoke('settings:set-app-observe-enabled', value), 'settings:set-app-observe-enabled')
  }
  const saveReposRoot = (): void => {
    if (reposRoot === null) return
    // Mirror main's normalization (blank → default) so the input reflects what
    // was actually stored instead of looking like the save was lost.
    const normalized = reposRoot.trim().length > 0 ? reposRoot.trim() : DEFAULT_REPOS_ROOT
    setReposRoot(normalized)
    fire(window.electron.ipc.invoke('settings:set-repos-root', normalized), 'settings:set-repos-root')
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

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Copilot</h2>
          <label className={styles.field}>
            <span className={styles.label}>
              Delegate to the Copilot app
              <span className={styles.hint}> — experimental; hands tasks to the installed desktop app when it's running and the repo is checked out locally, otherwise the cloud agent.</span>
            </span>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={appDelegate ?? false}
              disabled={appDelegate === null}
              onChange={(e) => changeAppDelegate(e.target.checked)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>
              Observe desktop-app sessions
              <span className={styles.hint}> — tracks sessions you open directly in the Copilot app (read-only) and shows them under the matching project. Turn off to stop watching.</span>
            </span>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={appObserve ?? false}
              disabled={appObserve === null}
              onChange={(e) => changeAppObserve(e.target.checked)}
            />
          </label>
          <div className={styles.field}>
            <span className={styles.label}>Repos root</span>
            <div className={styles.tokenRow}>
              <input
                className={styles.tokenInput}
                type="text"
                value={reposRoot ?? ''}
                placeholder="~/repos"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={reposRoot === null}
                onChange={(e) => setReposRoot(e.target.value)}
              />
              <button
                type="button"
                className={styles.primaryButton}
                disabled={reposRoot === null}
                onClick={saveReposRoot}
              >
                Save
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
