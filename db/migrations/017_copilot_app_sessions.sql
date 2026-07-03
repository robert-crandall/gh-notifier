-- Migration: 017_copilot_app_sessions.sql
-- PR2 (#86): delegated GitHub Copilot desktop-app sessions.
--
-- These live in a DEDICATED table (not copilot_sessions, which is github-only)
-- so the two session kinds never collide: app sessions have a different
-- lifecycle (WS/data.db status, no PR, deep-link open) and a separate store
-- means they can't leak into any existing github-session reader. project_id is
-- ON DELETE SET NULL as a safety net for hard deletes; the soft-delete detach
-- for these rows is wired when they're surfaced on project views (PR3 / #87).

CREATE TABLE copilot_app_sessions (
  id          TEXT    PRIMARY KEY,                 -- WS session_id (uuid)
  project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  cwd         TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'in_progress'
                CHECK (status IN ('in_progress', 'waiting', 'completed', 'unknown')),
  repo_owner  TEXT,
  repo_name   TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_copilot_app_sessions_project ON copilot_app_sessions(project_id);
