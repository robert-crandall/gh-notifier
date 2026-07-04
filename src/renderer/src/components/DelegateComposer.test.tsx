// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CopilotSession, DelegateResult } from '@shared/ipc-channels'
import { DelegateComposer } from './DelegateComposer'

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  ;(globalThis as unknown as { window: Window }).window.electron = {
    ipc: { invoke },
  } as unknown as Window['electron']
})

const session: CopilotSession = {
  id: 's1', projectId: 1, source: 'github', status: 'in_progress', title: 'Fix it',
  htmlUrl: 'https://x/pull/1', startedAt: '', updatedAt: '', repoOwner: 'o', repoName: 'r',
  branch: null, linkedPrUrl: 'https://x/pull/1', pinnedProjectId: 1,
}
const cloudResult: DelegateResult = { kind: 'cloud', session, appFallbackReason: 'no_local_cwd' }

describe('DelegateComposer', () => {
  it('pre-fills the prompt and delegates with the fixed repo', async () => {
    invoke.mockResolvedValue(cloudResult)
    const onLaunched = vi.fn()
    const onClose = vi.fn()
    render(
      <DelegateComposer
        initialPrompt="Fix the flaky test"
        projectId={1}
        fixedRepo={{ repoOwner: 'o', repoName: 'r' }}
        onClose={onClose}
        onLaunched={onLaunched}
      />
    )

    expect((screen.getByLabelText('Task') as HTMLTextAreaElement).value).toBe('Fix the flaky test')
    expect(screen.getByText('o/r')).toBeTruthy()

    fireEvent.click(screen.getByText('Launch task'))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('copilot:delegate', {
      prompt: 'Fix the flaky test',
      repoOwner: 'o',
      repoName: 'r',
      baseBranch: undefined,
      projectId: 1,
    }))
    await waitFor(() => expect(onLaunched).toHaveBeenCalledWith(cloudResult))
    expect(onClose).toHaveBeenCalled()
  })

  it('disables Launch when the prompt is empty', () => {
    render(
      <DelegateComposer
        initialPrompt=""
        projectId={1}
        fixedRepo={{ repoOwner: 'o', repoName: 'r' }}
        onClose={vi.fn()}
        onLaunched={vi.fn()}
      />
    )
    expect(screen.getByText('Launch task').closest('button')?.hasAttribute('disabled')).toBe(true)
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <DelegateComposer
        initialPrompt="x"
        projectId={1}
        fixedRepo={{ repoOwner: 'o', repoName: 'r' }}
        onClose={onClose}
        onLaunched={vi.fn()}
      />
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('surfaces a friendly auth error', async () => {
    invoke.mockRejectedValue(new Error('GH_NOT_AUTHENTICATED'))
    render(
      <DelegateComposer
        initialPrompt="do a thing"
        projectId={1}
        fixedRepo={{ repoOwner: 'o', repoName: 'r' }}
        onClose={vi.fn()}
        onLaunched={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Launch task'))
    expect(await screen.findByText(/gh auth login/)).toBeTruthy()
  })
})
