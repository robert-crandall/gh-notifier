-- Migration: 014_copilot_pinned_project.sql
-- MVP B: sticky project assignment for launched / manually-assigned agent tasks.
--
-- A session launched from (or manually assigned to) a project must stay there.
-- But `gh agent-task list` re-resolves project on every sync, and a just-launched
-- task usually resolves to NULL (no notification thread / repo rule yet), so it
-- would jump to the Unassigned surface on the next sync. pinned_project_id records
-- the explicit user intent; the sync writer preserves it and prefers it (when the
-- pinned project is still live) over auto-resolution. ON DELETE SET NULL is a
-- backstop; deleteProject also nulls it explicitly (matching how notifications
-- drop to the Inbox on project delete).
ALTER TABLE copilot_sessions
  ADD COLUMN pinned_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
