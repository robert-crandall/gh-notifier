-- Routing rules: AND-condition rules that route matched inbox threads to a specific project.
-- All non-null match_* conditions must match for the rule to fire (AND semantics).
-- Rules are evaluated in creation order; the first matching rule wins.

CREATE TABLE IF NOT EXISTS routing_rules (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  match_type       TEXT,        -- notification type (PullRequest, Issue, Release, etc.)
  match_reason     TEXT,        -- notification reason (review_requested, comment, etc.)
  match_repo_owner TEXT,        -- exact match against repo owner
  match_repo_name  TEXT,        -- exact match against repo name
  match_org        TEXT,        -- substring match against repo owner (org prefix / name)
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_routing_rules_project ON routing_rules(project_id);
