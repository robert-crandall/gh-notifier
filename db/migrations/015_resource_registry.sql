-- Migration: 015_resource_registry.sql
-- MVP C: the project brain. Typed resource registry + resolver support.
--
-- Replaces the flat project_links list (kept intact this release) with typed,
-- retrievable-on-demand records, a tiny always-injected project card, and a
-- resolution audit log that powers maintenance-by-use.
--
-- Timestamp convention: all *_at columns store ISO 8601 UTC strings
-- (e.g. 2026-07-02T18:07:44.167Z), matching the MVP A watermark columns.

-- ── Typed resource records ────────────────────────────────────────────────────
-- Each dashboard / saved query / doc / repo / link is a typed record, not a
-- bookmark. Retrieved on demand (never all injected), so hundreds scale fine.
CREATE TABLE resources (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title           TEXT    NOT NULL,
  kind            TEXT    NOT NULL DEFAULT 'link'
                    CHECK (kind IN ('dashboard', 'metric_query', 'saved_search', 'doc', 'link')),
  -- Tool / system the source lives in (e.g. 'datadog', 'splunk', 'github', 'generic').
  source          TEXT    NOT NULL DEFAULT 'generic',
  service         TEXT    NOT NULL DEFAULT '',
  env             TEXT    NOT NULL DEFAULT '',
  -- Machine-derived structured disambiguation attributes (JSON object), e.g.
  -- {"namespace":"…","cluster":"…","system":"…","team":"…"}. NOT user-groomed.
  tags_json       TEXT    NOT NULL DEFAULT '{}',
  -- Human fallback link. NULL when the source is purely an executable query.
  url             TEXT,
  description     TEXT    NOT NULL DEFAULT '',
  -- Alias/glossary terms that bridge fuzzy language to this record (JSON string[]).
  aliases_json    TEXT    NOT NULL DEFAULT '[]',
  provenance      TEXT    NOT NULL DEFAULT 'manual'
                    CHECK (provenance IN ('captured', 'manual', 'imported', 'agent')),
  confidence      REAL    NOT NULL DEFAULT 0.5,
  last_used       TEXT,
  last_verified   TEXT,
  failure_count   INTEGER NOT NULL DEFAULT 0,
  -- 1 = the source itself is suspect (a query that 400'd / returned no-data).
  suspect         INTEGER NOT NULL DEFAULT 0,
  -- Rare, visible browse override (pin/rename a computed group). NULL = auto.
  pinned_group    TEXT,

  -- Executable-source metadata (blocker #2): store the *runnable* query so it can
  -- be validated, replayed, and proven-run, instead of an opaque string.
  mcp_server      TEXT,   -- id of the wired per-project MCP server, NULL = none
  tool_name       TEXT,   -- MCP tool to call
  tool_args_json  TEXT,   -- JSON object of args passed to the tool
  external_ref    TEXT,   -- source-native id (dashboard id, saved-search id, …)
  validation_state TEXT   NOT NULL DEFAULT 'unverified'
                    CHECK (validation_state IN ('unverified', 'valid', 'invalid', 'no_data')),
  last_error_code TEXT,
  last_error_message TEXT,

  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at      TEXT    -- soft-delete tombstone; NULL = live
);

CREATE INDEX idx_resources_project        ON resources(project_id);
CREATE INDEX idx_resources_project_service ON resources(project_id, service);
CREATE INDEX idx_resources_project_suspect ON resources(project_id, suspect);

-- ── Project card ──────────────────────────────────────────────────────────────
-- The tiny, always-injected brief. One row per project, lazily created. Small
-- and stable; fields suggested/updated as a byproduct of use.
CREATE TABLE project_cards (
  project_id     INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  purpose        TEXT    NOT NULL DEFAULT '',
  repos_json     TEXT    NOT NULL DEFAULT '[]',   -- JSON string[]
  services_json  TEXT    NOT NULL DEFAULT '[]',   -- JSON string[]
  active_goal    TEXT    NOT NULL DEFAULT '',
  glossary_json  TEXT    NOT NULL DEFAULT '{}',   -- JSON { term: definition }
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ── Resolution audit / health log ─────────────────────────────────────────────
-- Records every resolve so staleness can surface only when relevant, and so
-- failures classify into bad-source vs bad-infra (only the former marks suspect).
CREATE TABLE resource_resolutions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_id       INTEGER REFERENCES resources(id) ON DELETE SET NULL,
  question          TEXT    NOT NULL,
  verdict           TEXT    NOT NULL
                      CHECK (verdict IN ('confident', 'source_available_no_live_value', 'clarify', 'none')),
  cited_resource_id INTEGER REFERENCES resources(id) ON DELETE SET NULL,
  answer            TEXT    NOT NULL DEFAULT '',
  failure_class     TEXT
                      CHECK (failure_class IN ('query_invalid', 'no_data', 'auth_missing',
                             'connector_down', 'timeout', 'model_bad_output', 'user_cancelled')),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_resolutions_project ON resource_resolutions(project_id, created_at);

-- ── Per-project MCP server config ─────────────────────────────────────────────
-- The wired MCP servers whose read-only tools the app-owned client may run.
-- Config is user/app-approved (never repo-injected). config_json is the exact
-- shape the app's MCP client uses to spawn/connect the server.
CREATE TABLE project_mcp_servers (
  id           TEXT    PRIMARY KEY,        -- stable id referenced by resources.mcp_server
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label        TEXT    NOT NULL DEFAULT '',
  config_json  TEXT    NOT NULL,           -- { command, args[], env{} } for stdio transport
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_mcp_servers_project ON project_mcp_servers(project_id);
