# Pre-release owner checklist (#77 items 4 + 3)

Most of items 4 and 3 are done + verified headlessly (see the PR). This file is the
short list of steps that genuinely need **you** - your machine, your signing
identity, and your SSO credentials. Everything else is already proven.

## What's already verified (no action needed)

- **Item 4 - offline model provisioning:** the MiniLM model is provisioned into
  `.model-cache/` at build time and bundled into the packaged app under
  `Resources/model-cache/`. Verified on an **unsigned `--dir` build**:
  - the electron-builder `afterPack` gate confirms the 4 model files are present
    (a build without them **fails**);
  - `@huggingface/transformers`, `onnxruntime-node`, `better-sqlite3`, and `sharp`
    all ship in the package (native binaries unpacked from the asar);
  - the packaged app loads the model **fully offline** (`allowRemoteModels=false`)
    and produces a 384-dim embedding - confirmed by running the packaged binary's
    `--embedding-smoke` mode.
- **Item 3 - app-owned MCP read:** the `verify-mcp` harness drives the app's real
  `listMcpTools` + `createMcpRunner` and was confirmed end-to-end against the
  synthetic echo MCP server (live value pulled, failure classes correct).

## Owner-only step 1 - confirm offline load on the SIGNED build (item 4)

The unsigned build is proven; the only thing I can't do is sign/notarize. After a
real signed build:

```bash
bun run dist            # signed + notarized .dmg (needs your Developer ID)
# then run the packaged binary's headless smoke mode:
"dist/mac-arm64/GH Projects.app/Contents/MacOS/GH Projects" --embedding-smoke
```

Expect:

```
[embedding-smoke] packaged=true cacheDir=…/Resources/model-cache allowRemoteModels=false
[embedding-smoke] OK: loaded model and produced a 384-dim embedding
```

`packaged=true` + `allowRemoteModels=false` + `OK` means the signed app loads the
model offline. Treat **"every distributable `.app` passes `--embedding-smoke`"** as
a required release step. (Optional: launch the app normally, ask the brain a
question, and confirm the resolve logs `retrievalMode:'semantic'` - not
`'lexical-fallback'` - on first use with the network off.)

## Owner-only step 2 - pull a real SSO-gated MCP value (item 3)

This needs your real Datadog/Splunk/Kusto MCP server + SSO credentials, which
can't live in the sandbox. Two ways, either is fine:

**A. One command (no GUI):** write a local config file (secrets stay on your
machine - never commit it):

```jsonc
// ~/datadog-mcp.json
{
  "label": "datadog",
  "command": "npx",
  "args": ["-y", "@datadog/mcp-server"],   // your real server command
  "env": { "DD_API_KEY": "…", "DD_APP_KEY": "…" },
  "tool": "search_logs",                     // a real read-only tool
  "toolArgs": { "query": "service:web", "from": "now-15m" }
}
```

```bash
bun run verify-mcp ~/datadog-mcp.json
```

Expect a non-empty `value:` and `✅ live value pulled through the app's real MCP
client.` A `failure` of `auth_missing`/`connector_down`/`timeout` points at
infra/creds; `query_invalid`/`no_data` points at the tool/args.

**B. In the app:** Settings → Connect a tool → enter the same server, then trigger
a resolve on a resource wired to it and confirm the live value renders.

Because the harness imports the app's *own* client code (not a reimplementation),
a green run in **A** proves the running app can pull the same value.
