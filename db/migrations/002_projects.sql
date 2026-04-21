-- Migration: 002_projects.sql
-- Adds projects, project_links, and project_todos tables for M3.

CREATE TABLE projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  notes       TEXT    NOT NULL DEFAULT '',
  next_action TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'snoozed')),
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE project_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label       TEXT    NOT NULL,
  url         TEXT    NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE project_todos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
