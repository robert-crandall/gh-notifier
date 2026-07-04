import type { App } from 'electron'
import { createLocalEmbedder, EMBEDDING_DIMS } from './embed'
import { resolveModelProvisioning } from './model-path'

/** CLI flag that triggers the headless embedding smoke test. */
export const EMBEDDING_SMOKE_FLAG = '--embedding-smoke'

/**
 * Headless packaged-runtime verifier. Loads the embedding model exactly as
 * production would (same `resolveModelProvisioning` → in a packaged app that's
 * the bundled model under `process.resourcesPath` with `allowRemoteModels:false`)
 * and asserts it produces a real 384-dim embedding. No window is created.
 *
 * This is the ONLY way to exercise the *packaged* node_modules + resourcesPath +
 * main-process runtime without a GUI: run `Focus.app/Contents/MacOS/Focus
 * --embedding-smoke` against a built app. Returns an exit code (0 = ok).
 */
export async function runEmbeddingSmoke(
  app: Pick<App, 'isPackaged' | 'getAppPath'>
): Promise<number> {
  const options = resolveModelProvisioning(app)
  console.log(
    `[embedding-smoke] packaged=${app.isPackaged} cacheDir=${options.cacheDir} ` +
      `allowRemoteModels=${options.allowRemoteModels}`
  )
  try {
    const embedder = createLocalEmbedder(options)
    const vectors = await embedder.embed(['embedding smoke test'])
    const dims = vectors[0]?.length ?? 0
    if (dims !== EMBEDDING_DIMS) {
      console.error(`[embedding-smoke] FAIL: expected ${EMBEDDING_DIMS} dims, got ${dims}`)
      return 1
    }
    console.log(`[embedding-smoke] OK: loaded model and produced a ${dims}-dim embedding`)
    return 0
  } catch (err) {
    console.error('[embedding-smoke] FAIL: model load/inference threw:', err)
    return 1
  }
}
