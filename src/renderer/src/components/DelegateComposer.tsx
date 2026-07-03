import { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import type { CopilotSession, LaunchTarget } from '@shared/ipc-channels'
import { Icon } from './Icon'
import styles from './DelegateComposer.module.css'

export interface DelegateComposerProps {
  /** Pre-filled task description (from the next action / todo / notification). */
  initialPrompt: string
  /** Originating project to pin the launched session to, or null. */
  projectId: number | null
  /**
   * A fixed target repo (e.g. launched from a notification, where the repo is
   * unambiguous). When set, repo resolution is skipped.
   */
  fixedRepo?: LaunchTarget
  onClose: () => void
  onLaunched: (session: CopilotSession) => void
}

const OTHER_REPO = '__other__'

function repoKey(t: LaunchTarget): string {
  return `${t.repoOwner}/${t.repoName}`
}

function friendlyError(message: string): string {
  if (message.includes('GH_NOT_AUTHENTICATED')) {
    return 'gh isn’t authenticated for agent tasks. Run `gh auth login` in a terminal, then try again.'
  }
  const stripped = message.replace(/^Error:\s*/, '').replace(/^LAUNCH_FAILED:\s*/, '')
  return stripped.length > 0 ? stripped : 'Could not launch the task.'
}

export function DelegateComposer({
  initialPrompt,
  projectId,
  fixedRepo,
  onClose,
  onLaunched,
}: DelegateComposerProps): JSX.Element {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [targets, setTargets] = useState<LaunchTarget[]>(fixedRepo ? [fixedRepo] : [])
  const [selected, setSelected] = useState<string>(fixedRepo ? repoKey(fixedRepo) : OTHER_REPO)
  const [customOwner, setCustomOwner] = useState('')
  const [customName, setCustomName] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  // Resolve candidate repos for a project-originated launch (skip when fixed).
  useEffect(() => {
    if (fixedRepo || projectId === null) return
    let active = true
    void (async () => {
      try {
        const list = await window.electron.ipc.invoke('copilot:launch-targets', projectId)
        if (!active) return
        setTargets(list)
        setSelected(list.length > 0 ? repoKey(list[0]) : OTHER_REPO)
      } catch (err) {
        console.error('[DelegateComposer] Failed to load launch targets:', err)
        if (active) setSelected(OTHER_REPO)
      }
    })()
    return () => { active = false }
  }, [fixedRepo, projectId])

  useEffect(() => {
    promptRef.current?.focus()
  }, [])

  // Escape closes the dialog (unless a launch is mid-flight), matching CommandPalette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const repoLocked = fixedRepo !== undefined
  const usingCustom = !repoLocked && selected === OTHER_REPO

  const resolvedRepo = useMemo<LaunchTarget | null>(() => {
    if (usingCustom) {
      const owner = customOwner.trim()
      const name = customName.trim()
      return owner.length > 0 && name.length > 0 ? { repoOwner: owner, repoName: name } : null
    }
    return targets.find((t) => repoKey(t) === selected) ?? null
  }, [usingCustom, customOwner, customName, targets, selected])

  const canLaunch = prompt.trim().length > 0 && resolvedRepo !== null && !busy

  const launch = async (): Promise<void> => {
    if (resolvedRepo === null || prompt.trim().length === 0) return
    setBusy(true)
    setError(null)
    try {
      const session = await window.electron.ipc.invoke('copilot:launch', {
        prompt: prompt.trim(),
        repoOwner: resolvedRepo.repoOwner,
        repoName: resolvedRepo.repoName,
        baseBranch: baseBranch.trim() || undefined,
        projectId,
      })
      onLaunched(session)
      onClose()
    } catch (err: unknown) {
      setError(friendlyError(err instanceof Error ? err.message : String(err)))
      setBusy(false)
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Delegate to Copilot">
        <div className={styles.header}>
          <Icon icon={Sparkles} size={15} className={styles.headerIcon} />
          <span className={styles.headerTitle}>Delegate to Copilot</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <Icon icon={X} size={15} />
          </button>
        </div>

        <div className={styles.body}>
          <label className={styles.label} htmlFor="delegate-prompt">Task</label>
          <textarea
            id="delegate-prompt"
            ref={promptRef}
            className={styles.prompt}
            value={prompt}
            rows={4}
            placeholder="Describe the task for Copilot to finish…"
            onChange={(e) => setPrompt(e.target.value)}
          />

          <label className={styles.label} htmlFor="delegate-repo">Repository</label>
          {repoLocked ? (
            <div className={styles.repoLocked}>{repoKey(fixedRepo)}</div>
          ) : (
            <>
              <select
                id="delegate-repo"
                className={styles.select}
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                {targets.map((t) => (
                  <option key={repoKey(t)} value={repoKey(t)}>{repoKey(t)}</option>
                ))}
                <option value={OTHER_REPO}>Other repo…</option>
              </select>
              {usingCustom && (
                <div className={styles.customRepo}>
                  <input
                    className={styles.input}
                    value={customOwner}
                    placeholder="owner"
                    aria-label="Repository owner"
                    onChange={(e) => setCustomOwner(e.target.value)}
                  />
                  <span className={styles.slash}>/</span>
                  <input
                    className={styles.input}
                    value={customName}
                    placeholder="repo"
                    aria-label="Repository name"
                    onChange={(e) => setCustomName(e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          <label className={styles.label} htmlFor="delegate-base">Base branch (optional)</label>
          <input
            id="delegate-base"
            className={styles.input}
            value={baseBranch}
            placeholder="default branch"
            onChange={(e) => setBaseBranch(e.target.value)}
          />

          {error && <div className={styles.error}>{error}</div>}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.secondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={styles.primary} onClick={() => void launch()} disabled={!canLaunch}>
            <Icon icon={Sparkles} size={14} />
            {busy ? 'Launching…' : 'Launch task'}
          </button>
        </div>
      </div>
    </div>
  )
}
