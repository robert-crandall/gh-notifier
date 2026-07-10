-- Migration: 021_copilot_app_sessions_observed.sql
-- #119: observe sessions opened DIRECTLY in the Copilot desktop app.
--
-- Until now every row in copilot_app_sessions was a session GH Projects itself
-- launched over the WS (origin implicitly "launched"). #119 adds sessions the
-- user opened directly in the app, reconciled read-only from the app's on-disk
-- session-state store. Two columns distinguish and sticky-assign them:
--   - origin: 'launched' (Projects created it) vs 'observed' (we found it). The
--     reconciler never downgrades a launched row to observed.
--   - pinned_project_id: sticky manual/auto assignment, mirroring the semantics
--     copilot_sessions already uses for cloud tasks, so an observed session that
--     resolves to a project stays put across reconciles and manual assignment
--     wins. ON DELETE SET NULL is a backstop for hard deletes.
--
-- Existing rows are all Projects-launched, so origin defaults to 'launched'.

ALTER TABLE copilot_app_sessions
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'launched'
    CHECK (origin IN ('launched', 'observed'));

ALTER TABLE copilot_app_sessions
  ADD COLUMN pinned_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
