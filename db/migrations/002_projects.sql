-- Migration: 002_projects.sql
-- M3: Project management tables

CREATE TABLE projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  notes       TEXT    NOT NULL DEFAULT '',
  next_action TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'snoozed')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE project_todos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  text        TEXT    NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,  -- 0 = false, 1 = true
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE project_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label       TEXT    NOT NULL,
  url         TEXT    NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
