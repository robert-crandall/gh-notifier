-- Migration: 003_notifications.sql
-- M4: Notification sync and routing tables

CREATE TABLE notification_threads (
  id           TEXT    PRIMARY KEY,               -- GitHub thread ID (string)
  project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL, -- NULL = inbox
  repo_owner   TEXT    NOT NULL,
  repo_name    TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  type         TEXT    NOT NULL,                  -- 'PullRequest', 'Issue', 'Release', 'Discussion', etc.
  reason       TEXT    NOT NULL,                  -- 'mention', 'assign', 'subscribed', etc.
  unread       INTEGER NOT NULL DEFAULT 1,        -- 0 = read, 1 = unread
  updated_at   TEXT    NOT NULL,
  last_read_at TEXT,
  api_url      TEXT    NOT NULL,
  synced_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_notification_threads_project ON notification_threads(project_id);
CREATE INDEX idx_notification_threads_repo ON notification_threads(repo_owner, repo_name);

CREATE TABLE repo_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_owner  TEXT    NOT NULL,
  repo_name   TEXT    NOT NULL,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(repo_owner, repo_name)
);
