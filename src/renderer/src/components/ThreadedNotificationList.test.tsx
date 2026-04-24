// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ThreadedNotificationList } from './ThreadedNotificationList'
import type { NotificationThread } from '@shared/ipc-channels'

beforeEach(() => {
  ;(window as unknown as Record<string, unknown>).electron = {
    ipc: { invoke: vi.fn() },
    openExternal: vi.fn(),
    onNotificationsUpdated: vi.fn(() => vi.fn()),
  }
})

const mockThreads: NotificationThread[] = [
  {
    id: '1',
    projectId: null,
    repoOwner: 'owner',
    repoName: 'repo-one',
    title: 'PR #1',
    type: 'PullRequest',
    reason: 'author',
    unread: true,
    updatedAt: '2024-01-01T00:00:00Z',
    lastReadAt: null,
    apiUrl: 'https://api.github.com/notifications/threads/1',
    subjectUrl: 'https://api.github.com/repos/owner/repo-one/pulls/1',
    subjectState: 'open',
    htmlUrl: 'https://github.com/owner/repo-one/pull/1',
  },
  {
    id: '2',
    projectId: null,
    repoOwner: 'owner',
    repoName: 'repo-one',
    title: 'Issue #2',
    type: 'Issue',
    reason: 'mention',
    unread: false,
    updatedAt: '2024-01-02T00:00:00Z',
    lastReadAt: '2024-01-02T01:00:00Z',
    apiUrl: 'https://api.github.com/notifications/threads/2',
    subjectUrl: 'https://api.github.com/repos/owner/repo-one/issues/2',
    subjectState: 'open',
    htmlUrl: 'https://github.com/owner/repo-one/issues/2',
  },
  {
    id: '3',
    projectId: null,
    repoOwner: 'other',
    repoName: 'repo-two',
    title: 'PR #3',
    type: 'PullRequest',
    reason: 'review_requested',
    unread: true,
    updatedAt: '2024-01-03T00:00:00Z',
    lastReadAt: null,
    apiUrl: 'https://api.github.com/notifications/threads/3',
    subjectUrl: 'https://api.github.com/repos/other/repo-two/pulls/3',
    subjectState: 'open',
    htmlUrl: 'https://github.com/other/repo-two/pull/3',
  },
]

describe('ThreadedNotificationList', () => {
  const onMarkRead = vi.fn()
  const onMarkReadMany = vi.fn()
  const onUnsubscribe = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('grouping', () => {
    it('groups threads by repo and type', () => {
      render(
        <ThreadedNotificationList
          threads={mockThreads}
          onMarkRead={onMarkRead}
          onUnsubscribe={onUnsubscribe}
        />
      )

      // Should show two repo groups
      expect(screen.getByText('owner/repo-one')).toBeInTheDocument()
      expect(screen.getByText('other/repo-two')).toBeInTheDocument()

      // Should show type labels within each repo (note: multiple repos may have same type)
      expect(screen.getAllByText('Pull Requests').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('Issues')).toBeInTheDocument()
    })

    it('shows counts per type group', () => {
      render(
        <ThreadedNotificationList
          threads={mockThreads}
          onMarkRead={onMarkRead}
          onUnsubscribe={onUnsubscribe}
        />
      )

      // owner/repo-one has 1 PR and 1 Issue
      const counts = screen.getAllByText('1')
      expect(counts.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('collapse/expand', () => {
    it('collapses and expands repo groups', async () => {
      render(
        <ThreadedNotificationList
          threads={mockThreads}
          onMarkRead={onMarkRead}
          onUnsubscribe={onUnsubscribe}
        />
      )

      // Initially, threads should be visible
      expect(screen.getByText('PR #1')).toBeInTheDocument()

      // Find the collapse button for owner/repo-one
      const collapseBtn = screen.getByLabelText('Collapse owner/repo-one')
      fireEvent.click(collapseBtn)

      // Threads should be hidden
      await waitFor(() => {
        expect(screen.queryByText('PR #1')).not.toBeInTheDocument()
      })

      // Button label should change
      expect(screen.getByLabelText('Expand owner/repo-one')).toBeInTheDocument()

      // Expand again
      fireEvent.click(screen.getByLabelText('Expand owner/repo-one'))
      await waitFor(() => {
        expect(screen.getByText('PR #1')).toBeInTheDocument()
      })
    })

    it('collapses and expands type groups', async () => {
      render(
        <ThreadedNotificationList
          threads={mockThreads}
          onMarkRead={onMarkRead}
          onUnsubscribe={onUnsubscribe}
        />
      )

      // Initially, threads should be visible
      expect(screen.getByText('PR #1')).toBeInTheDocument()

      // Find the collapse button for Pull Requests in owner/repo-one
      const collapseBtn = screen.getByLabelText('Collapse owner/repo-one Pull Requests')
      fireEvent.click(collapseBtn)

      // PR #1 should be hidden, but Issue #2 should still be visible
      await waitFor(() => {
        expect(screen.queryByText('PR #1')).not.toBeInTheDocument()
      })
      expect(screen.getByText('Issue #2')).toBeInTheDocument()

      // Expand again
      fireEvent.click(screen.getByLabelText('Expand owner/repo-one Pull Requests'))
      await waitFor(() => {
        expect(screen.getByText('PR #1')).toBeInTheDocument()
      })
    })

    it('sets aria-expanded correctly on repo collapse buttons', () => {
      render(
        <ThreadedNotificationList
          threads={mockThreads}
          onMarkRead={onMarkRead}
          onUnsubscribe={onUnsubscribe}
        />
      )

      const collapseBtn = screen.getByLabelText('Collapse owner/repo-one')
      expect(collapseBtn).toHaveAttribute('aria-expanded', 'true')

      fireEvent.click(collapseBtn)
      expect(screen.getByLabelText('Expand owner/repo-one')).toHaveAttribute('aria-expanded', 'false')
    })

    it('sets aria-expanded correctly on type collapse buttons', () => {
      render(
        <ThreadedNotificationList
          threads={mockThreads}
          onMarkRead={onMarkRead}
          onUnsubscribe={onUnsubscribe}
        />
      )

      const collapseBtn = screen.getByLabelText('Collapse owner/repo-one Pull Requests')
      expect(collapseBtn).toHaveAttribute('aria-expanded', 'true')

      fireEvent.click(collapseBtn)
      expect(screen.getByLabelText('Expand owner/repo-one Pull Requests')).toHaveAttribute('aria-expanded', 'false')
    })
  })

  describe('mark all read', () => {
    it('uses bulk API when onMarkReadMany is provided', async () => {
      render(
        <ThreadedNotificationList
          threads={mockThreads}
          onMarkRead={onMarkRead}
          onMarkReadMany={onMarkReadMany}
          onUnsubscribe={onUnsubscribe}
        />
      )

      // Click "Mark all read" for owner/repo-one
      const markAllBtns = screen.getAllByText('Mark all read')
      const repoMarkAll = markAllBtns[0] // First button is for the repo group
      fireEvent.click(repoMarkAll)

      await waitFor(() => {
        expect(onMarkReadMany).toHaveBeenCalledWith(['1']) // Only unread thread in owner/repo-one
      })
      expect(onMarkRead).not.toHaveBeenCalled()
    })

    it('falls back to individual calls when onMarkReadMany is not provided', async () => {
      render(
        <ThreadedNotificationList
          threads={mockThreads}
          onMarkRead={onMarkRead}
          onUnsubscribe={onUnsubscribe}
        />
      )

      const markAllBtns = screen.getAllByText('Mark all read')
      const repoMarkAll = markAllBtns[0]
      fireEvent.click(repoMarkAll)

      await waitFor(() => {
        expect(onMarkRead).toHaveBeenCalledWith('1')
      })
      expect(onMarkReadMany).not.toHaveBeenCalled()
    })

    it('only calls onMarkRead for unread threads', async () => {
      render(
        <ThreadedNotificationList
          threads={mockThreads}
          onMarkRead={onMarkRead}
          onMarkReadMany={onMarkReadMany}
          onUnsubscribe={onUnsubscribe}
        />
      )

      // Click "Mark all read" for owner/repo-one (has 1 unread, 1 already read)
      const markAllBtns = screen.getAllByText('Mark all read')
      fireEvent.click(markAllBtns[0])

      await waitFor(() => {
        expect(onMarkReadMany).toHaveBeenCalledWith(['1']) // Only thread '1' is unread
      })
    })

    it('disables button while mark all is in flight', async () => {
      onMarkReadMany.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))

      render(
        <ThreadedNotificationList
          threads={mockThreads}
          onMarkRead={onMarkRead}
          onMarkReadMany={onMarkReadMany}
          onUnsubscribe={onUnsubscribe}
        />
      )

      const markAllBtns = screen.getAllByText('Mark all read')
      const repoMarkAll = markAllBtns[0]
      fireEvent.click(repoMarkAll)

      // Button should be disabled immediately
      expect(repoMarkAll).toBeDisabled()

      // Wait for completion
      await waitFor(() => {
        expect(repoMarkAll).not.toBeDisabled()
      }, { timeout: 200 })
    })

    it('does not show "Mark all read" button when all threads are read', () => {
      const allReadThreads = mockThreads.map(t => ({ ...t, unread: false }))
      render(
        <ThreadedNotificationList
          threads={allReadThreads}
          onMarkRead={onMarkRead}
          onUnsubscribe={onUnsubscribe}
        />
      )

      expect(screen.queryByText('Mark all read')).not.toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('shows empty message when no threads', () => {
      render(
        <ThreadedNotificationList
          threads={[]}
          onMarkRead={onMarkRead}
          onUnsubscribe={onUnsubscribe}
          emptyMessage="Nothing here"
        />
      )

      expect(screen.getByText('Nothing here')).toBeInTheDocument()
    })

    it('uses default empty message', () => {
      render(
        <ThreadedNotificationList
          threads={[]}
          onMarkRead={onMarkRead}
          onUnsubscribe={onUnsubscribe}
        />
      )

      expect(screen.getByText('No notifications.')).toBeInTheDocument()
    })
  })
})
