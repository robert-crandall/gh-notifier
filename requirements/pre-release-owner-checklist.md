# Pre-release owner checklist (#77 item 4)

Item 4 is done + verified headlessly (see the PR). This file is the short list of
steps that genuinely need **you** - your machine and your signing identity.
Everything else is already proven.

> Note: item 3 (the app-owned MCP read) was retired in #99, so its owner-only
> verification step is gone. The app no longer reaches out to run MCP tools.

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

## Owner-only step - confirm offline load on the SIGNED build (item 4)

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
a required release step. (Optional: launch the app normally, ask the brain for
relevant sources, and confirm the recommendation logs `retrievalMode:'semantic'`
- not `'lexical-fallback'` - on first use with the network off.)
