-- Tracks when the subject state (open/merged/closed) was last verified for a thread.
-- Allows the prefetch to throttle re-checks of open threads to avoid unnecessary API calls.
ALTER TABLE notification_threads ADD COLUMN state_checked_at TEXT; -- ISO 8601; NULL = never checked
