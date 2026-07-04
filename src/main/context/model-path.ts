import { statSync } from 'fs'
import { join } from 'path'
import type { App } from 'electron'
import { MODEL_CACHE_SUBPATH, REQUIRED_MODEL_FILES } from './embed'
import type { EmbedderOptions } from './embed'

/**
 * Resolves how the local embedding model is provisioned for the current
 * environment — the packaged-vs-dev crux of offline model loading.
 *
 * Strategy: transformers.js `cacheDir` semantics. The download layout and the
 * offline-read layout are identical (`<cacheDir>/Xenova/all-MiniLM-L6-v2/...`),
 * so one dir serves both. With `allowRemoteModels: false` and the model present,
 * transformers.js performs zero writes, so pointing `cacheDir` at a read-only
 * bundled dir in a packaged app is safe.
 *
 * Bundle-before-flip: the offline flag is only forced `false` where the model is
 * guaranteed present — a packaged build (whose model presence is enforced by the
 * electron-builder afterPack gate) or a dev checkout we've probed as complete.
 * A fresh `bun run dev` with no provisioned model keeps remote fetches enabled so
 * it can self-heal, never silently degrading to lexical-only forever.
 */

/** Where the bundled model lives inside a packaged app's Resources. */
const PACKAGED_MODEL_DIR = 'model-cache'

/** Where `provision-model` writes the dev model cache (gitignored, repo root). */
const DEV_MODEL_DIR = '.model-cache'

/** True when `p` exists AND is a regular file (not a directory). */
function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** True when every required model file exists as a real file under `<cacheDir>/<subpath>/`. */
export function isModelProvisioned(cacheDir: string): boolean {
  const modelDir = join(cacheDir, MODEL_CACHE_SUBPATH)
  // Require actual files — `existsSync` is true for directories too, so a stray
  // dir named like a model file could otherwise be mistaken for a provisioned
  // model and wrongly force offline mode.
  return REQUIRED_MODEL_FILES.every((f) => isFile(join(modelDir, f)))
}

/**
 * Computes the embedder options for the current environment.
 *
 * - Packaged (prod): the bundled model under `resourcesPath`, `allowRemoteModels`
 *   ALWAYS `false` — production must never reach the network. If the model were
 *   somehow missing, the load fails cleanly and the retriever falls back to
 *   lexical (still offline); shipping a model-less build is separately blocked at
 *   build time by the afterPack gate.
 * - Dev, model present (all required files): mirror prod — offline.
 * - Dev, model absent/incomplete: allow remote (one-time self-heal) and warn, so
 *   a fresh dev environment still brings up semantic retrieval.
 */
export function resolveModelProvisioning(app: Pick<App, 'isPackaged' | 'getAppPath'>): EmbedderOptions {
  if (app.isPackaged) {
    return { cacheDir: join(process.resourcesPath, PACKAGED_MODEL_DIR), allowRemoteModels: false }
  }

  const cacheDir = join(app.getAppPath(), DEV_MODEL_DIR)
  if (isModelProvisioned(cacheDir)) {
    return { cacheDir, allowRemoteModels: false }
  }

  console.warn(
    `[model-path] embedding model not provisioned at ${cacheDir}; allowing a one-time ` +
      `remote fetch so dev keeps working. Run \`bun run provision-model\` to make it offline.`
  )
  return { cacheDir, allowRemoteModels: true }
}
