/**
 * Filesystem locations for per-service knowledge (issue #100).
 *
 * Layout under the app-data root (`~/.gh-projects/`, mirroring `run/`):
 *   knowledge/<service>.md              — one human-editable runbook per service
 *   knowledge/.history/<service>/<ts>.md — timestamped backups made before each
 *                                          overwrite (so an ungated write is
 *                                          recoverable)
 *
 * The `GH_PROJECTS_KNOWLEDGE_DIR` env override lets tests point at an isolated
 * temp dir instead of the real `~/.gh-projects/knowledge`, exactly like
 * `GH_PROJECTS_RUN_DIR` does for the MCP run files. Dependency-free (node
 * builtins only) so the store + tools stay cheap to unit test.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** Directory holding the per-service markdown runbooks. */
export function knowledgeDir(): string {
  const override = process.env.GH_PROJECTS_KNOWLEDGE_DIR
  if (override !== undefined && override.trim().length > 0) return override
  return join(homedir(), '.gh-projects', 'knowledge')
}

/**
 * Directory holding version-history backups. A hidden `.history` sibling of the
 * runbooks — safe from collision because service keys can never begin with `.`
 * (see `validateServiceName`), so no runbook file/dir can be named `.history`.
 */
export function historyDir(dir: string = knowledgeDir()): string {
  return join(dir, '.history')
}
