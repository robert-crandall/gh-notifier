-- Add action column to routing_rules and make project_id nullable.
-- action='route'    → route matched threads to project_id (write-time, via Apply to Inbox)
-- action='suppress' → hide matched threads from all views (read-time, like filters)
-- project_id is required when action='route' and must be NULL when action='suppress'.

-- SQLite cannot ALTER COLUMN, so recreate the table.
CREATE TABLE IF NOT EXISTS routing_rules_v2 (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id       INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  action           TEXT NOT NULL DEFAULT 'route' CHECK(action IN ('route', 'suppress')),
  match_type       TEXT,
  match_reason     TEXT,
  match_repo_owner TEXT,
  match_repo_name  TEXT,
  match_org        TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO routing_rules_v2 (id, project_id, action, match_type, match_reason, match_repo_owner, match_repo_name, match_org, created_at)
SELECT id, project_id, 'route', match_type, match_reason, match_repo_owner, match_repo_name, match_org, created_at
FROM routing_rules;

DROP TABLE routing_rules;

ALTER TABLE routing_rules_v2 RENAME TO routing_rules;

CREATE INDEX IF NOT EXISTS idx_routing_rules_project ON routing_rules(project_id);
CREATE INDEX IF NOT EXISTS idx_routing_rules_action  ON routing_rules(action);
