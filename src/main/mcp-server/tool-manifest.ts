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

/** The full inbound tool surface. Order is the advertised order. */
export const TOOL_MANIFEST: readonly ManifestTool[] = [
  {
    name: PING_TOOL_NAME,
    title: 'Ping',
    description:
      "No-op liveness check for the GH Projects inbound MCP server. Returns 'pong'.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

/** Lookup a manifest tool by name; undefined when not present. */
export function findManifestTool(name: string): ManifestTool | undefined {
  return TOOL_MANIFEST.find((tool) => tool.name === name)
}
