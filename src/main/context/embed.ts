import type { FeatureExtractionPipeline } from '@huggingface/transformers'

/**
 * Local text embedder for semantic retrieval. Wraps transformers.js running a
 * small sentence-transformer (all-MiniLM-L6-v2, 384-dim, mean-pooled + L2
 * normalized). Off the render thread (main process only).
 *
 * Model provisioning is the CALLER's concern (this module stays electron-free so
 * it's unit-testable without an Electron env): pass a `cacheDir` pointing at a
 * provisioned model and `allowRemoteModels: false` for a fully-offline load, or
 * leave both unset to keep transformers.js defaults (download-on-first-use), which
 * is what the dev eval/golden scripts rely on. See `model-path.ts` for the
 * packaged-vs-dev resolution that decides those options.
 *
 * The model is loaded lazily on first use and reused. Any load/inference failure
 * is surfaced to the caller so the retriever can fall back to lexical scoring.
 */

export interface Embedder {
  /** Embeds each text into an L2-normalized vector. Throws on load/inference failure. */
  embed(texts: string[]): Promise<number[][]>
}

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'

/** The model id used for embeddings (also stamped into golden vectors). */
export const EMBEDDING_MODEL_ID = MODEL_ID

/**
 * The model's repo-relative directory under a transformers.js cache dir, i.e.
 * files live at `<cacheDir>/<MODEL_CACHE_SUBPATH>/...`. Same string as the model
 * id by construction; named separately so path-building code reads clearly.
 */
export const MODEL_CACHE_SUBPATH = MODEL_ID

/** Dimensionality of the embedding vectors this model produces. */
export const EMBEDDING_DIMS = 384

/**
 * Files that must ALL be present (under `<cacheDir>/<MODEL_CACHE_SUBPATH>/`) for a
 * fully-offline load to succeed. Used by the provisioning completeness check, the
 * dev presence probe, and the packaged afterPack gate. Kept here (electron-free)
 * so every consumer shares one list.
 */
export const REQUIRED_MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model.onnx',
] as const

export interface EmbedderOptions {
  /**
   * Writable/read-only dir holding the transformers.js model cache (required in a
   * packaged app, whose bundle is read-only so the default node_modules cache
   * would fail). The model resolves under `<cacheDir>/Xenova/all-MiniLM-L6-v2/...`.
   */
  cacheDir?: string
  /**
   * Whether transformers.js may fetch the model from the HuggingFace Hub. Leave
   * unset for the library default (`true`). Set `false` to force a fully-offline
   * load: if the model isn't present in `cacheDir` the load throws (and the
   * retriever falls back to lexical) rather than touching the network.
   */
  allowRemoteModels?: boolean
}

/** Creates a lazily-initialized local embedder. */
export function createLocalEmbedder(options: EmbedderOptions = {}): Embedder {
  let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null

  async function getPipeline(): Promise<FeatureExtractionPipeline> {
    if (pipelinePromise === null) {
      // Import lazily so merely importing this module doesn't pull the runtime in.
      pipelinePromise = import('@huggingface/transformers').then(({ pipeline, env }) => {
        // transformers.js `env` is process-global mutable state. Set the remote
        // policy DETERMINISTICALLY every time (defaulting to the library default,
        // `true`) so a prior configured load — e.g. an offline provisioning run —
        // can't leave a later default caller unexpectedly offline (or vice versa).
        env.allowRemoteModels = options.allowRemoteModels ?? true
        // cacheDir only changes WHERE the model is read/written, not the network
        // policy, so it's set only when provided (default callers use the library
        // default cache location).
        if (options.cacheDir !== undefined) env.cacheDir = options.cacheDir
        return pipeline('feature-extraction', MODEL_ID)
      })
      // Don't cache a transient load failure forever — reset so later calls retry.
      pipelinePromise.catch(() => {
        pipelinePromise = null
      })
    }
    return pipelinePromise
  }

  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return []
      const extractor = await getPipeline()
      const output = await extractor(texts, { pooling: 'mean', normalize: true })
      // output is a Tensor of shape [texts.length, dims]; tolist() gives number[][].
      const rows: unknown = output.tolist()
      if (
        !Array.isArray(rows) ||
        rows.length !== texts.length ||
        !rows.every(
          (r) =>
            Array.isArray(r) && r.length > 0 && r.every((n) => typeof n === 'number' && Number.isFinite(n))
        )
      ) {
        throw new Error(`unexpected embedding output shape/values for ${texts.length} texts`)
      }
      return rows as number[][]
    },
  }
}
