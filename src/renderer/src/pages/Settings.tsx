import styles from './Settings.module.css'
import { AuthPanel } from '../components/AuthPanel'
import { useAuth } from '../hooks/useAuth'

export function Settings() {
  const { status, isLoading, error, savePat, logout } = useAuth()

  return (
    <div className={styles.main}>
      <header className={styles.toolbar}>
        <span className={styles.toolbarTitle}>Settings</span>
      </header>

      <div className={styles.content}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>GitHub Account</h2>
          <div className={styles.sectionBody}>
            <AuthPanel
              status={status}
              isLoading={isLoading}
              error={error}
              onSavePat={savePat}
              onLogout={logout}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
