import { useState } from 'react'
import styles from './AuthPanel.module.css'
import type { AuthStatus } from '@shared/ipc-channels'

interface Props {
  status: AuthStatus | null
  isLoading: boolean
  error: string | null
  onSavePat: (token: string) => void
  onLogout: () => void
}

export function AuthPanel({ status, isLoading, error, onSavePat, onLogout }: Props) {
  const [draft, setDraft] = useState('')

  if (isLoading) {
    return <div className={styles.panel}><span className={styles.muted}>Checking auth…</span></div>
  }

  if (status?.authenticated) {
    return (
      <div className={styles.panel}>
        <img
          className={styles.avatar}
          src={status.avatarUrl}
          alt={status.login}
          width={32}
          height={32}
        />
        <span className={styles.login}>@{status.login}</span>
        <button className={styles.secondaryButton} onClick={onLogout}>
          Sign out
        </button>
      </div>
    )
  }

  return (
    <div className={styles.form}>
      <p className={styles.instruction}>
        Paste a GitHub{' '}
        <a
          className={styles.link}
          onClick={() =>
            window.open(
              'https://github.com/settings/tokens/new?scopes=notifications,read:user&description=Focus'
            )
          }
        >
          Personal Access Token
        </a>{' '}
        with <code>notifications</code> and <code>read:user</code> scopes.
      </p>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          type="password"
          placeholder="ghp_…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) onSavePat(draft)
          }}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          className={styles.primaryButton}
          onClick={() => onSavePat(draft)}
          disabled={!draft.trim()}
        >
          Connect
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}
