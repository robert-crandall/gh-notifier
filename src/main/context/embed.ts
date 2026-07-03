import type { FeatureExtractionPipeline } from '@huggingface/transformers'

/**
 * Local text embedder for semantic retrieval. Wraps transformers.js running a
 * small sentence-transformer (all-MiniLM-L6-v2, 384-dim, mean-pooled + L2
 * normalized). Fully local: the model downloads once to the transformers.js
 * cache and then runs offline. Off the render thread (main process only).
 *
 * The model is loaded lazily on first use and reused. Any load/inference failure
 * is surfaced to the caller so the retriever can fall back to lexical scoring.
 */

export interface Embedder {
  /** Embeds each text into an L2-normalized vector. Throws on load/inference failure. */
  embed(texts: string[]): Promise<number[][]>
}

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'

export interface EmbedderOptions {
  /** Writable dir for the downloaded model cache (required in a packaged app). */
  cacheDir?: string
}

/** Creates a lazily-initialized local embedder. */
export function createLocalEmbedder(options: EmbedderOptions = {}): Embedder {
  let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null

  async function getPipeline(): Promise<FeatureExtractionPipeline> {
    if (pipelinePromise === null) {
      // Import lazily so merely importing this module doesn't pull the runtime in.
      pipelinePromise = import('@huggingface/transformers').then(({ pipeline, env }) => {
        // Point the model cache at a writable location (a packaged app bundle is
        // read-only, so the default node_modules cache would fail).
        if (options.cacheDir !== undefined) env.cacheDir = options.cacheDir
        return pipeline('feature-extraction', MODEL_ID)
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
      const rows = output.tolist() as number[][]
      return rows
    },
  }
}
