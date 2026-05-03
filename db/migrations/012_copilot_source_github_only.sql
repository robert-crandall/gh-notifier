-- Narrow copilot_sessions.source to 'github' only.
-- SQLite does not support ALTER TABLE ... ALTER COLUMN, so we recreate the table.
CREATE TABLE copilot_sessions_new (
  id           TEXT    PRIMARY KEY,
  project_id   INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  source       TEXT    NOT NULL CHECK (source IN ('github')),
  status       TEXT    NOT NULL CHECK (status IN ('in_progress', 'waiting', 'pr_ready', 'completed')),
  title        TEXT    NOT NULL DEFAULT '',
  html_url     TEXT,
  started_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  repo_owner   TEXT,
  repo_name    TEXT,
  branch       TEXT,
  linked_pr_url TEXT
);

-- Only carry over rows that already have source = 'github'.
-- Legacy cli/vscode-chat rows are intentionally dropped.
INSERT INTO copilot_sessions_new SELECT * FROM copilot_sessions WHERE source = 'github';
DROP TABLE copilot_sessions;
ALTER TABLE copilot_sessions_new RENAME TO copilot_sessions;

CREATE INDEX IF NOT EXISTS idx_copilot_sessions_project ON copilot_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_copilot_sessions_status  ON copilot_sessions(status);
