-- Migration: 006_filters.sql
-- M7: Notification filtering

CREATE TABLE filters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dimension   TEXT NOT NULL,   -- 'author' | 'org' | 'repo' | 'reason' | 'state' | 'type'
  value       TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'global', -- 'global' | 'repo'
  scope_owner TEXT,            -- non-null when scope = 'repo'
  scope_repo  TEXT,            -- non-null when scope = 'repo'
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  -- Per-repo scope only valid for the 'type' dimension
  CHECK (scope = 'global' OR (scope = 'repo' AND scope_owner IS NOT NULL AND scope_repo IS NOT NULL))
);

CREATE INDEX idx_filters_dimension ON filters(dimension);
CREATE INDEX idx_filters_scope ON filters(scope);
