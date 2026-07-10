/**
 * The tool surface of the inbound MCP server — the single source of truth for
 * BOTH the loopback server (which registers handlers) and the stdio shim (which
 * serves this list statically for `tools/list`, so the advertised surface is
 * stable and never empty even when the app is down).
 *
 * Deliberately dependency-free and JSON-Schema-based (no zod), so it is
 * JSON-serializable and cheap to bundle into the shim. Because the shim ships
 * inside the same app bundle as the server, the two can never drift.
 *
 * Later epic issues (#102/#100/#106/#105) add real tools by appending to
 * `TOOL_MANIFEST` here and adding the matching handler in `tools.ts`. For the
 * foundation there is exactly one no-op tool: `ping`.
 */

/** A JSON Schema object describing a tool's input. */
export interface JsonSchemaObject {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

/** A single tool's advertised metadata (the `tools/list` shape). */
export interface ManifestTool {
  name: string
  title?: string
  description: string
  inputSchema: JsonSchemaObject
}

/** The `ping` tool: no input, exercises the surface end-to-end. */
export const PING_TOOL_NAME = 'ping'

/** The `add_todo` tool: Copilot creates a human-gated action-proposal todo in a project. */
export const ADD_TODO_TOOL_NAME = 'add_todo'

/** The `list_projects` tool: the read-only project roster (#106). */
export const LIST_PROJECTS_TOOL_NAME = 'list_projects'

/** The `get_project_context` tool: the read-only situational brief for one project (#106). */
export const GET_PROJECT_CONTEXT_TOOL_NAME = 'get_project_context'

/** The `get_reentry_digest` tool: the read-only "what changed while I was away" digest (#106). */
export const GET_REENTRY_DIGEST_TOOL_NAME = 'get_reentry_digest'

/**
 * A `project` reference: an exact project NAME (JSON string, case-insensitive) or a project ID
 * (JSON integer, as returned by `list_projects`). String→name, number→id — unambiguous. The
 * `minLength`/`minimum` bounds mirror what the handlers accept (a non-empty name, a positive id),
 * so a client can fail fast before calling.
 */
const PROJECT_REF_SCHEMA = {
  type: ['string', 'integer'],
  minLength: 1,
  minimum: 1,
  description:
    'Project reference: an exact project name (string) or a project id (integer) from list_projects.',
}

/** The full inbound tool surface. Order is the advertised order. */
export const TOOL_MANIFEST: readonly ManifestTool[] = [
  {
    name: PING_TOOL_NAME,
    title: 'Ping',
    description:
      "No-op liveness check for the GH Projects inbound MCP server. Returns 'pong'.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: ADD_TODO_TOOL_NAME,
    title: 'Add todo',
    description:
      'Create a human-gated todo in a GH Projects project. Use this to PROPOSE an action ' +
      '(e.g. after reviewing a PR) instead of performing it — this tool NEVER writes to ' +
      'GitHub, it only files a todo the human can approve. Placement: an explicit `project` ' +
      '(exact name) wins; otherwise `repo` (owner/name) is routed to a project via the same ' +
      'rules notifications use; otherwise it lands in the Inbox. Repeated calls that carry the ' +
      'same `sourceUrl` and `suggestedAction` update the existing todo instead of duplicating.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Exact name of the project to file the todo under. Takes precedence over `repo`.',
        },
        repo: {
          type: 'string',
          description: "Repository as 'owner/name'. Routed to a project via routing rules; falls back to the Inbox.",
        },
        title: {
          type: 'string',
          description: 'Short, imperative todo title. Required.',
        },
        body: {
          type: 'string',
          description: 'Optional markdown detail / instructions. Rendered as plain linkified text.',
        },
        sourceUrl: {
          type: 'string',
          description: 'Optional PR/issue URL (http/https). Shown as a clickable link and used for dedup.',
        },
        suggestedAction: {
          description:
            'Optional one-tap action hint. Advisory only - the app renders an affordance but never ' +
            'performs a GitHub write automatically. Shape depends on `kind`.',
          oneOf: [
            {
              type: 'object',
              properties: {
                kind: { const: 'pr_comment' },
                url: { type: 'string', description: 'PR/issue URL (http/https).' },
                comment: { type: 'string', description: 'Comment body to propose.' },
              },
              required: ['kind', 'url', 'comment'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                kind: { const: 'delegate' },
                prompt: { type: 'string', description: 'Prompt to hand Copilot.' },
              },
              required: ['kind', 'prompt'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                kind: { const: 'open_url' },
                url: { type: 'string', description: 'URL to open (http/https).' },
              },
              required: ['kind', 'url'],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: LIST_PROJECTS_TOOL_NAME,
    title: 'List projects',
    description:
      'READ-ONLY. List the GH Projects roster so you know what exists before acting. Returns one ' +
      'lean row per project — id, name, status (active/snoozed), next action, and open-todo count. ' +
      'Mutates nothing. Use the returned id or name with get_project_context and get_reentry_digest; ' +
      'pass the project NAME (not id) to add_todo.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: GET_PROJECT_CONTEXT_TOOL_NAME,
    title: 'Get project context',
    description:
      "READ-ONLY. Get one project's situational brief so you act with context: its card (purpose, " +
      'repos, services, active goal, glossary), open todos, links, and saved brain resources. ' +
      '`services` lists the project\'s service names; per-service runbook bodies are surfaced ' +
      'separately once available. Mutates nothing.',
    inputSchema: {
      type: 'object',
      properties: { project: PROJECT_REF_SCHEMA },
      required: ['project'],
      additionalProperties: false,
    },
  },
  {
    name: GET_REENTRY_DIGEST_TOOL_NAME,
    title: 'Get re-entry digest',
    description:
      'READ-ONLY. Get the blame-free "what changed while I was away / what should I pick up" digest ' +
      'the app computes (recent Copilot sessions + unread activity) plus each project\'s drift ' +
      'state. Pass `project` for one project; omit it for every project with new activity or drift. ' +
      'Mutates nothing.',
    inputSchema: {
      type: 'object',
      properties: { project: PROJECT_REF_SCHEMA },
      additionalProperties: false,
    },
  },
]

/** Lookup a manifest tool by name; undefined when not present. */
export function findManifestTool(name: string): ManifestTool | undefined {
  return TOOL_MANIFEST.find((tool) => tool.name === name)
}
