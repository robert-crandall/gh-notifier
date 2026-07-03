-- Migration: 016_project_mcp_servers_soft_delete.sql
-- MVP C: soft-delete for wired MCP servers so a "Disconnect a tool" delete is
-- losslessly undoable (undo over confirmation) without nulling the resource
-- links that point at the server. Mirrors the soft-delete pattern already used
-- for resources.
--
-- deleted_at stores an ISO 8601 UTC string when soft-deleted, NULL when live.

ALTER TABLE project_mcp_servers ADD COLUMN deleted_at TEXT;
