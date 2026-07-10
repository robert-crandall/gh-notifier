/**
 * The three READ-ONLY inbound MCP tools (#106): `list_projects`, `get_project_context`, and
 * `get_reentry_digest`. They expose the app's OWN computed state so Copilot is situationally
 * aware before it acts (the higher-value half of epic #98).
 *
 * Hard invariant: these NEVER write — not to GitHub (unsubscribe stays the only GitHub write),
 * and not to the local DB. In particular they use `getProjectCardReadOnly` (which returns a
 * default card without inserting a row), never the lazily-creating `getProjectCard`. A
 * `total_changes()` regression test guards this.
 *
 * Payload shape: each tool returns `structuredContent` (the typed payload, the machine-readable
 * source of truth with ids for follow-up tools) plus a short human/agent-scannable text summary.
 * We deliberately do NOT stuff the whole payload into one text block: `sanitizeMcpText` caps every
 * string leaf at 2000 chars, which would silently truncate — and thus corrupt — a whole-payload
 * JSON string. Keeping the bulk in `structuredContent` means each leaf stays small and the
 * structure survives. The genuinely-unbounded markdown fields (todo body, resource description)
 * are capped intentionally here (not left to the sanitizer) and flagged.
 *
 * `project` accepts a NAME (JSON string, resolved via the same case-insensitive resolver
 * `add_todo` uses) or an ID (JSON integer). String→name, number→id is unambiguous and mirrors the
 * exact JSON types `list_projects` returns.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type {
  DigestItem,
  DriftState,
  ProjectLink,
  ProjectStatus,
  ProjectTodo,
  Resource,
  ResourceKind,
  SuggestedAction,
  TodoOrigin,
} from '../../shared/ipc-channels'
import { getDb } from '../db'
import { listProjects, getProject } from '../db/projects'
import { resolveProjectIdByName } from '../db/routing-rules'
import { getProjectCardReadOnly, listResources } from '../context/registry'
import { getDigest } from '../digest'

/** Hard caps on the list sections so a huge project can't produce a bloated payload. */
const OPEN_TODO_LIMIT = 50
const RESOURCE_LIMIT = 30
/** Intentional per-field caps on the genuinely-long markdown leaves. */
const TODO_BODY_MAX = 600
const RESOURCE_DESCRIPTION_MAX = 300

// ── Result helpers ────────────────────────────────────────────────────────────

/** A successful read result: a short text summary + the typed payload as structuredContent. */
function ok(summary: string, structured: object): CallToolResult {
  return {
    content: [{ type: 'text', text: summary }],
    // The SDK types structuredContent as Record<string, unknown>; our typed DTOs are plain
    // JSON objects, so this widening cast is safe (no `any`).
    structuredContent: structured as unknown as Record<string, unknown>,
  }
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

/** Cap a string to `max` chars, reporting whether it was shortened. */
function capText(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false }
  return { text: `${value.slice(0, max - 1)}…`, truncated: true }
}

// ── Project reference resolution ──────────────────────────────────────────────

interface LiveProjectRef {
  id: number
  name: string
}

/** Look up a live (non-deleted) project by id. */
function getLiveProjectById(id: number): LiveProjectRef | null {
  const row = getDb()
    .prepare('SELECT id, name FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { id: number; name: string } | undefined
  return row ?? null
}

/**
 * Resolve a `project` argument to a live project. A JSON string resolves by NAME (exact,
 * case-insensitive — the same resolver `add_todo` uses); a positive-integer JSON number resolves
 * by ID. Anything else (float, empty, unknown, soft-deleted) → null.
 */
function resolveProjectRef(value: unknown): LiveProjectRef | null {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) return null
    return getLiveProjectById(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return null
    const id = resolveProjectIdByName(trimmed)
    // resolveProjectIdByName only returns live ids; re-read for the canonical name.
    return id === null ? null : getLiveProjectById(id)
  }
  return null
}

// ── DTOs (main-only; nothing here crosses the IPC boundary to the renderer) ────

interface ProjectSummary {
  id: number
  name: string
  status: ProjectStatus
  nextAction: string
  activeTodoCount: number
}

interface ProjectCardView {
  purpose: string
  repos: string[]
  services: string[]
  activeGoal: string
  glossary: Record<string, string>
  updatedAt: string
}

interface OpenTodoView {
  id: number
  /** Agent-todo title, or null for a plain user todo (use `title ?? text` as the label). */
  title: string | null
  text: string
  sourceUrl: string | null
  suggestedAction: SuggestedAction | null
  origin: TodoOrigin
  /** Instructions, capped to keep the payload lean; `bodyTruncated` flags when shortened. */
  body: string | null
  bodyTruncated: boolean
}

interface LinkView {
  id: number
  label: string
  url: string
}

interface ResourceView {
  id: number
  title: string
  kind: ResourceKind
  source: string
  service: string
  env: string
  url: string | null
  description: string
  descriptionTruncated: boolean
}

interface ProjectContext {
  project: {
    id: number
    name: string
    status: ProjectStatus
    nextAction: string
    driftState: DriftState
    activeTodoCount: number
    unreadCount: number
    updatedAt: string
  }
  card: ProjectCardView
  openTodos: OpenTodoView[]
  /** Total open todos (before the `OPEN_TODO_LIMIT` cap). */
  openTodoCount: number
  openTodosTruncated: boolean
  links: LinkView[]
  resources: ResourceView[]
  /** Total live resources (before the `RESOURCE_LIMIT` cap). */
  resourceCount: number
  resourcesTruncated: boolean
}

interface ProjectDigestView {
  projectId: number
  name: string
  driftState: DriftState
  asOf: string
  items: DigestItem[]
}

// ── Mappers ───────────────────────────────────────────────────────────────────

function toOpenTodoView(todo: ProjectTodo): OpenTodoView {
  const body = todo.body === null ? null : capText(todo.body, TODO_BODY_MAX)
  return {
    id: todo.id,
    title: todo.title,
    text: todo.text,
    sourceUrl: todo.sourceUrl,
    suggestedAction: todo.suggestedAction,
    origin: todo.origin,
    body: body === null ? null : body.text,
    bodyTruncated: body?.truncated ?? false,
  }
}

function toLinkView(link: ProjectLink): LinkView {
  return { id: link.id, label: link.label, url: link.url }
}

function toResourceView(resource: Resource): ResourceView {
  const description = capText(resource.description, RESOURCE_DESCRIPTION_MAX)
  return {
    id: resource.id,
    title: resource.title,
    kind: resource.kind,
    source: resource.source,
    service: resource.service,
    env: resource.env,
    url: resource.url,
    description: description.text,
    descriptionTruncated: description.truncated,
  }
}

// ── Tools ───────────────────────────────────────────────────────────────────

/**
 * `list_projects`: the project roster so Copilot can pick a project to act on. One lean row per
 * live project (snoozed included; `status` distinguishes them).
 */
export function runListProjects(): CallToolResult {
  const projects: ProjectSummary[] = listProjects().map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    nextAction: p.nextAction,
    activeTodoCount: p.activeTodoCount,
  }))

  const summary =
    projects.length === 0
      ? 'No projects yet.'
      : `${projects.length} project${projects.length === 1 ? '' : 's'}: ${projects
          .map((p) => `${p.name} (${p.status}, ${p.activeTodoCount} open todo${p.activeTodoCount === 1 ? '' : 's'})`)
          .join('; ')}.`

  return ok(summary, { projects })
}

/**
 * `get_project_context`: the full situational brief for one project — its card (purpose, repos,
 * services, active goal, glossary), open todos, links, and brain resources. `services` is the
 * list of service names; per-service runbook BODIES attach later once #100 lands (kept decoupled
 * so the two PRs don't block each other).
 */
export function runGetProjectContext(args: Record<string, unknown>): CallToolResult {
  const ref = resolveProjectRef(args.project)
  if (ref === null) {
    return errorResult(
      'No live project matches `project`. Pass an exact project name (string) or a project id (number) from list_projects.'
    )
  }

  const detail = getProject(ref.id)
  const card = getProjectCardReadOnly(ref.id)
  const allResources = listResources(ref.id)

  const openTodosAll = detail.todos.filter((t) => !t.done)
  const openTodos = openTodosAll.slice(0, OPEN_TODO_LIMIT).map(toOpenTodoView)
  const resources = allResources.slice(0, RESOURCE_LIMIT).map(toResourceView)

  const payload: ProjectContext = {
    project: {
      id: detail.id,
      name: detail.name,
      status: detail.status,
      nextAction: detail.nextAction,
      driftState: detail.driftState,
      activeTodoCount: detail.activeTodoCount,
      unreadCount: detail.unreadCount,
      updatedAt: detail.updatedAt,
    },
    card: {
      purpose: card.purpose,
      repos: card.repos,
      services: card.services,
      activeGoal: card.activeGoal,
      glossary: card.glossary,
      updatedAt: card.updatedAt,
    },
    openTodos,
    openTodoCount: openTodosAll.length,
    openTodosTruncated: openTodosAll.length > openTodos.length,
    links: detail.links.map(toLinkView),
    resources,
    resourceCount: allResources.length,
    resourcesTruncated: allResources.length > resources.length,
  }

  const summary =
    `${detail.name} — ${card.purpose.trim().length > 0 ? card.purpose.trim() : 'no purpose set'}. ` +
    `Active goal: ${card.activeGoal.trim().length > 0 ? card.activeGoal.trim() : 'none'}. ` +
    `${payload.openTodoCount} open todo${payload.openTodoCount === 1 ? '' : 's'}, ` +
    `${payload.resourceCount} resource${payload.resourceCount === 1 ? '' : 's'}. ` +
    `Services: ${card.services.length > 0 ? card.services.join(', ') : 'none'}.`

  return ok(summary, payload)
}

/** Build one project's digest view (name + drift + computed items). */
function digestViewFor(id: number, name: string, driftState: DriftState): ProjectDigestView {
  const digest = getDigest(id)
  return { projectId: id, name, driftState, asOf: digest.asOf, items: digest.items }
}

/**
 * `get_reentry_digest`: the blame-free "what changed while I was away / what should I pick up"
 * digest. With a `project`, returns that one project's digest. Without one, returns every project
 * that either has digest activity OR is drifting (the resurface signal) — deliberately-parked
 * (snoozed, no activity) projects are omitted so we don't nag about what the user set aside.
 */
export function runGetReentryDigest(args: Record<string, unknown>): CallToolResult {
  if (args.project !== undefined && args.project !== null) {
    const ref = resolveProjectRef(args.project)
    if (ref === null) {
      return errorResult(
        'No live project matches `project`. Pass an exact project name (string) or a project id (number) from list_projects, or omit `project` for a digest across all projects.'
      )
    }
    // detail gives the drift classification the roster uses.
    const detail = getProject(ref.id)
    const view = digestViewFor(ref.id, ref.name, detail.driftState)
    const summary =
      view.items.length === 0
        ? `${ref.name}: nothing new since you were last here (drift: ${view.driftState}).`
        : `${ref.name}: ${view.items.length} update${view.items.length === 1 ? '' : 's'} since you were away (drift: ${view.driftState}).`
    return ok(summary, view)
  }

  const projects = listProjects()
    .map((p) => digestViewFor(p.id, p.name, p.driftState))
    .filter((view) => view.items.length > 0 || view.driftState === 'drifting')

  const summary =
    projects.length === 0
      ? 'Nothing to pick up — no project has new activity or drift.'
      : `${projects.length} project${projects.length === 1 ? '' : 's'} to pick up: ${projects
          .map((p) => `${p.name} (${p.items.length} update${p.items.length === 1 ? '' : 's'}, drift: ${p.driftState})`)
          .join('; ')}.`

  return ok(summary, { projects })
}
