import styles from './Settings.module.css'
import { AuthPanel } from '../components/AuthPanel'
import { FilterSection } from '../components/FilterSection'
import { useAuth } from '../hooks/useAuth'
import { useFilters } from '../hooks/useFilters'
import { THEMES, type ThemeId } from '../hooks/useTheme'

interface SettingsProps {
  theme: ThemeId
  onThemeChange: (theme: ThemeId) => void
}

export function Settings({ theme, onThemeChange }: SettingsProps) {
  const { status, isLoading, error, savePat, logout } = useAuth()
  const { filters, isLoading: filtersLoading, addFilter, removeFilter } = useFilters()

  return (
    <div className={styles.main}>
      <header className={styles.toolbar}>
        <span className={styles.toolbarTitle}>Settings</span>
      </header>

      <div className={styles.content}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Theme</h2>
          <div className={styles.themeGrid}>
            {THEMES.map((t) => (
              <button
                key={t.id}
                data-theme={t.id}
                className={`${styles.themeCard} ${theme === t.id ? styles.themeCardActive : ''}`}
                onClick={() => onThemeChange(t.id)}
                title={t.label}
              >
                <span className={styles.themeSwatches}>
                  <span className={styles.swatch} style={{ background: 'var(--color-base-100)' }} />
                  <span className={styles.swatch} style={{ background: 'var(--color-primary)' }} />
                  <span className={styles.swatch} style={{ background: 'var(--color-secondary)' }} />
                  <span className={styles.swatch} style={{ background: 'var(--color-accent)' }} />
                </span>
                <span className={styles.themeLabel}>{t.label}</span>
              </button>
            ))}
          </div>
        </section>

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

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Notification Filters</h2>
          <div className={styles.sectionBody}>
            <FilterSection
              filters={filters}
              onAdd={addFilter}
              onRemove={removeFilter}
              isLoading={filtersLoading}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
