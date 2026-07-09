-- Migration: 020_agent_todos.sql
-- #102: enrich project_todos so Copilot (the inbound MCP server) can create rich,
-- human-gated "action proposal" todos, and so a todo can sit in the Inbox (no
-- project) when its repo doesn't resolve to one.
--
-- SQLite cannot relax a NOT NULL constraint in place, and we need project_id to be
-- NULLABLE (NULL = Inbox surface). So we rebuild project_todos, preserving ids so the
-- dependent FK (todo_copilot_app_sessions.todo_id -> project_todos(id)) stays valid.
--
-- foreign_keys MUST be OFF around the DROP: with it ON, dropping the parent performs an
-- implicit DELETE that cascades and would wipe todo_copilot_app_sessions. PRAGMA
-- foreign_keys is a no-op inside a transaction, so we toggle it OUTSIDE the tx and do the
-- swap INSIDE BEGIN..COMMIT for atomicity. New columns are additive with back-compat
-- defaults: existing rows keep their ids/project_id, get origin='user', and NULL for the
-- new fields.

PRAGMA foreign_keys=OFF;

BEGIN IMMEDIATE;

-- Preserve the AUTOINCREMENT high-water mark so ids are never reused after the rebuild.
CREATE TEMP TABLE _todo_seq_backup AS
  SELECT seq FROM sqlite_sequence WHERE name = 'project_todos';

CREATE TABLE project_todos_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id       INTEGER REFERENCES projects(id) ON DELETE CASCADE,  -- NULLABLE: NULL = Inbox
  text             TEXT    NOT NULL,
  done             INTEGER NOT NULL DEFAULT 0,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at       TEXT,
  title            TEXT,
  body             TEXT,
  source_url       TEXT,
  suggested_action TEXT,   -- JSON-encoded SuggestedAction, or NULL
  origin           TEXT    NOT NULL DEFAULT 'user' CHECK(origin IN ('user', 'copilot')),
  idempotency_key  TEXT
);

INSERT INTO project_todos_new
  (id, project_id, text, done, sort_order, created_at, deleted_at)
  SELECT id, project_id, text, done, sort_order, created_at, deleted_at
  FROM project_todos;

DROP TABLE project_todos;
ALTER TABLE project_todos_new RENAME TO project_todos;

-- Restore the high-water mark (max of the new table's own value and the backed-up one).
UPDATE sqlite_sequence
  SET seq = MAX(seq, COALESCE((SELECT seq FROM _todo_seq_backup), 0))
  WHERE name = 'project_todos';

DROP TABLE _todo_seq_backup;

-- Enforce one agent todo per idempotency key while allowing unlimited NULL keys
-- (every user todo has a NULL key).
CREATE UNIQUE INDEX idx_project_todos_idempotency
  ON project_todos(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Speed up per-project loads and the Inbox (project_id IS NULL) query.
CREATE INDEX idx_project_todos_project ON project_todos(project_id);

COMMIT;

PRAGMA foreign_keys=ON;
