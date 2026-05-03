-- Copilot agent session tracking.
-- Stores sessions from three sources: gh agent-task list (github),
-- ~/.copilot/session-state/ (cli), and VS Code workspace storage (vscode-chat).
CREATE TABLE IF NOT EXISTS copilot_sessions (
  id           TEXT    PRIMARY KEY, -- task UUID (github) or session UUID (cli/vscode-chat)
  project_id   INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  source       TEXT    NOT NULL CHECK (source IN ('github', 'cli', 'vscode-chat')),
  status       TEXT    NOT NULL CHECK (status IN ('in_progress', 'waiting', 'pr_ready', 'completed')),
  title        TEXT    NOT NULL DEFAULT '',
  html_url     TEXT,
  started_at   TEXT    NOT NULL, -- ISO 8601
  updated_at   TEXT    NOT NULL, -- ISO 8601
  repo_owner   TEXT,
  repo_name    TEXT,
  branch       TEXT,
  linked_pr_url TEXT,
  synced_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_copilot_sessions_project ON copilot_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_copilot_sessions_status  ON copilot_sessions(status);
