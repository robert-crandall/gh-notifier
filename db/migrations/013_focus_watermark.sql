-- Migration: 013_focus_watermark.sql
-- MVP A: re-entry digest watermarks, drift tracking, and soft-delete.
--
-- Timestamp convention: all columns below store ISO 8601 UTC strings (e.g.
-- 2026-07-02T18:07:44.167Z). Digest/drift comparisons normalize both operands
-- with SQLite julianday() (millisecond-precise and format-agnostic) so these
-- compare correctly against the legacy datetime('now') space-separated columns.

-- Drift anchor: set on focus arrival. NULL until first focused.
ALTER TABLE projects ADD COLUMN last_focused_at TEXT;

-- Digest watermark: advanced only when the user dismisses the digest.
ALTER TABLE projects ADD COLUMN digest_seen_at TEXT;

-- Resurface cooldown for drifting projects ("not now"). The frequency cap.
ALTER TABLE projects ADD COLUMN drift_snoozed_until TEXT;

-- Soft-delete tombstone. NULL = live.
ALTER TABLE projects ADD COLUMN deleted_at TEXT;

-- Soft-delete tombstone for todos.
ALTER TABLE project_todos ADD COLUMN deleted_at TEXT;

-- Backfill so existing projects are not instantly "drifting" after upgrade.
UPDATE projects
SET last_focused_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE last_focused_at IS NULL;
