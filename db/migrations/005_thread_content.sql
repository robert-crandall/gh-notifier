-- Migration: 005_thread_content.sql
-- M5: Thread content prefetch — adds subject URL, resolved state, html_url, and fetch tracking

ALTER TABLE notification_threads ADD COLUMN subject_url TEXT;           -- GitHub API URL for the PR/Issue subject
ALTER TABLE notification_threads ADD COLUMN subject_state TEXT;         -- 'open', 'closed', 'merged'; NULL = not yet fetched
ALTER TABLE notification_threads ADD COLUMN html_url TEXT;              -- Direct browser URL for the PR/Issue
ALTER TABLE notification_threads ADD COLUMN content_fetched_at TEXT;    -- ISO 8601 timestamp (YYYY-MM-DDTHH:MM:SS.sssZ); NULL = content not yet fetched
