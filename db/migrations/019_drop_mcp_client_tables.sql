-- Migration: 019_drop_mcp_client_tables.sql
-- Retire the app's MCP-client / resolver execution path (#99).
--
-- These tables backed the removed app-as-MCP-client feature and have no
-- remaining runtime usage:
--   project_mcp_servers  — wired stdio MCP servers (secret-bearing env config)
--   resource_resolutions — the resolve audit log (RUN + verdict-from-live-value)
--
-- Drop them so no dead (and no secret-bearing) rows linger. Additive: the
-- resources table's now-inert mcp/health columns are intentionally left in
-- place — a broader Resource reshape is deferred to the typed-vs-markdown
-- decision (#104).

DROP TABLE IF EXISTS resource_resolutions;
DROP TABLE IF EXISTS project_mcp_servers;
