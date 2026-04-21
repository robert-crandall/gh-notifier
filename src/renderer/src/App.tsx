import styles from './App.module.css'
import { AuthPanel } from './components/AuthPanel'
import { useAuth } from './hooks/useAuth'

export function App() {
  const { status, isLoading, error, savePat, logout } = useAuth()

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Focus</h1>
      <AuthPanel
        status={status}
        isLoading={isLoading}
        error={error}
        onSavePat={savePat}
        onLogout={logout}
      />
    </div>
  )
}
