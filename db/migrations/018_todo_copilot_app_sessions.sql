-- Migration: 018_todo_copilot_app_sessions.sql
-- PR3 (#87): link delegated Copilot desktop-app sessions to the todo they came
-- from, so a todo can show "Copilot working on this" + live status.
--
-- A join table (not a single column) so a todo can carry MULTIPLE app sessions
-- over time — re-delegating a todo never hides a still-running prior session.
-- Both sides ON DELETE CASCADE: deleting the todo (hard) or the app session
-- removes the link. (Todos soft-delete via deleted_at, which keeps the link so a
-- restore re-surfaces it.)

CREATE TABLE todo_copilot_app_sessions (
  todo_id     INTEGER NOT NULL REFERENCES project_todos(id) ON DELETE CASCADE,
  session_id  TEXT    NOT NULL REFERENCES copilot_app_sessions(id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (todo_id, session_id)
);

CREATE INDEX idx_todo_app_sessions_session ON todo_copilot_app_sessions(session_id);
