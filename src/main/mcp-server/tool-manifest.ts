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
          type: 'object',
          description:
            'Optional one-tap action hint. Advisory only — the app renders an affordance but never ' +
            'performs a GitHub write automatically.',
          properties: {
            kind: { type: 'string', enum: ['pr_comment', 'delegate', 'open_url'] },
            url: { type: 'string', description: 'Target URL for pr_comment / open_url (http/https).' },
            comment: { type: 'string', description: 'Comment body for pr_comment.' },
            prompt: { type: 'string', description: 'Prompt to hand Copilot for delegate.' },
          },
          required: ['kind'],
          additionalProperties: false,
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
]

/** Lookup a manifest tool by name; undefined when not present. */
export function findManifestTool(name: string): ManifestTool | undefined {
  return TOOL_MANIFEST.find((tool) => tool.name === name)
}
