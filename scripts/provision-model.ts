/**
 * Provisions the local embedding model so the packaged app can run fully offline.
 *
 * Downloads the exact MiniLM model transformers.js loads by default into a
 * gitignored `.model-cache/` at the repo root (same `cacheDir` layout the runtime
 * reads), verifies completeness + a fully-offline reload, and records provenance.
 * electron-builder bundles `.model-cache` into the packaged app's Resources.
 *
 * Reuses the app's REAL embedder (`createLocalEmbedder`) — no reimplementation.
 *
 * Run:
 *   bun --bun run scripts/provision-model.ts               # strict (used by dist)
 *   bun --bun run scripts/provision-model.ts --best-effort # used by `setup`
 *
 * Strict mode fails on any error. Best-effort mode warns + exits 0 ONLY when the
 * model can't be downloaded (offline/network), so a fresh `bun run setup` without
 * network still succeeds (dev self-heals at runtime). It still FAILS on local
 * integrity problems (incomplete files, wrong dims, corrupt cache) so a real
 * provisioning bug is never masked.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import {
  createLocalEmbedder,
  EMBEDDING_DIMS,
  EMBEDDING_MODEL_ID,
  MODEL_CACHE_SUBPATH,
  REQUIRED_MODEL_FILES,
} from '../src/main/context/embed'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CACHE_DIR = join(REPO_ROOT, '.model-cache')

/** A local-integrity failure that must fail even in best-effort mode. */
class IntegrityError extends Error {}

function modelFilesPresent(): boolean {
  const modelDir = join(CACHE_DIR, MODEL_CACHE_SUBPATH)
  return REQUIRED_MODEL_FILES.every((f) => existsSync(join(modelDir, f)))
}

/** True when ANY required model file already exists (a partial/possibly-corrupt cache). */
function anyModelFilesPresent(): boolean {
  const modelDir = join(CACHE_DIR, MODEL_CACHE_SUBPATH)
  return REQUIRED_MODEL_FILES.some((f) => existsSync(join(modelDir, f)))
}

/** Loads the model with the given remote policy and asserts it yields 384 dims. */
async function assertEmbeds(allowRemoteModels: boolean): Promise<void> {
  const embedder = createLocalEmbedder({ cacheDir: CACHE_DIR, allowRemoteModels })
  const vectors = await embedder.embed(['provisioning check'])
  const dims = vectors[0]?.length ?? 0
  if (dims !== EMBEDDING_DIMS) {
    throw new IntegrityError(`expected ${EMBEDDING_DIMS} dims, got ${dims}`)
  }
}

/** Records the resolved upstream commit for traceability (best-effort). */
async function writeProvenance(): Promise<void> {
  let sha: string | null = null
  try {
    const res = await fetch(`https://huggingface.co/api/models/${EMBEDDING_MODEL_ID}/revision/main`)
    if (res.ok) {
      const body = (await res.json()) as { sha?: unknown }
      if (typeof body.sha === 'string') sha = body.sha
    }
  } catch {
    // Provenance is informational — never fail provisioning over it.
  }
  const provenance = {
    modelId: EMBEDDING_MODEL_ID,
    resolvedSha: sha,
    provisionedAt: new Date().toISOString(),
    files: REQUIRED_MODEL_FILES,
  }
  writeFileSync(join(CACHE_DIR, 'PROVENANCE.json'), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8')
}

async function main(): Promise<void> {
  const bestEffort = process.argv.includes('--best-effort')
  mkdirSync(CACHE_DIR, { recursive: true })

  if (modelFilesPresent()) {
    console.log(`[provision] model already present at ${CACHE_DIR}; verifying offline load…`)
    // Files exist → any failure here is a local-integrity problem, never network.
    await assertEmbeds(false)
    await writeProvenance()
    console.log('[provision] OK: existing model loads offline (384 dims).')
    return
  }

  console.log(`[provision] downloading ${EMBEDDING_MODEL_ID} into ${CACHE_DIR}…`)
  // A partial cache present here (some but not all required files) is suspect: a
  // corrupt/interrupted file can make transformers throw on the local copy before
  // it repairs. Only a truly pristine dir is safe to treat a failure as "just
  // offline" in best-effort mode; otherwise fail loudly so it gets re-provisioned.
  const partialCache = anyModelFilesPresent()
  try {
    await assertEmbeds(true)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (bestEffort && !partialCache) {
      // Truly pristine + can't download → offline/network. Dev self-heals later.
      console.warn(
        `[provision] could not download the model (${msg}). ` +
          'Continuing (best-effort): dev will fetch it on first use. Run `bun run provision-model` when online.'
      )
      return
    }
    if (partialCache) {
      throw new IntegrityError(
        `partial/corrupt model cache at ${CACHE_DIR} and (re)provisioning failed (${msg}). ` +
          'Delete .model-cache and rerun `bun run provision-model`.'
      )
    }
    throw err
  }

  // Downloaded — now integrity checks that must fail even in best-effort mode.
  if (!modelFilesPresent()) {
    throw new IntegrityError('download completed but required model files are missing')
  }
  await assertEmbeds(false)
  await writeProvenance()
  console.log('[provision] OK: model downloaded and loads fully offline (384 dims).')
}

main().catch((err: unknown) => {
  console.error('[provision] FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
