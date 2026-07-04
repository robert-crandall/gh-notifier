// electron-builder afterPack hook (build tooling — must be require()-able by the
// electron-builder node process, hence CommonJS .cjs rather than app TS source).
//
// The bundle-before-flip build gate: the packaged app forces the embedding model
// offline (`allowRemoteModels: false`), so a build that ships WITHOUT the bundled
// model would silently degrade to lexical-only forever. This hook FAILS the build
// if the provisioned model files didn't land under the app's Resources, so such a
// build can never be produced.
//
// The gate prefers the bundled PROVENANCE.json (written by provision-model.ts) as
// the source of truth for what should be present. The constants below are only a
// FALLBACK when provenance is missing/unreadable; they mirror REQUIRED_MODEL_FILES
// / MODEL_CACHE_SUBPATH in src/main/context/embed.ts.

const path = require('node:path')
const fs = require('node:fs')

// True only when `p` exists AND is a regular file (existsSync is also true for
// directories, which would let a broken bundle pass the gate).
function isFile(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

const MODEL_CACHE_SUBPATH = 'Xenova/all-MiniLM-L6-v2'
const REQUIRED_MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model.onnx',
]

exports.default = async function afterPackVerifyModel(context) {
  const { appOutDir, packager, electronPlatformName } = context

  // Resources layout differs per platform; this app targets macOS.
  let resourcesDir
  if (electronPlatformName === 'darwin' || electronPlatformName === 'mas') {
    const appName = `${packager.appInfo.productFilename}.app`
    resourcesDir = path.join(appOutDir, appName, 'Contents', 'Resources')
  } else {
    resourcesDir = path.join(appOutDir, 'resources')
  }

  const modelCacheDir = path.join(resourcesDir, 'model-cache')

  // Prefer the bundled PROVENANCE.json (written by provision-model.ts) as the
  // single source of truth for what should be present, so this gate can't drift
  // if the model id / file list changes. Fall back to the mirrored constants.
  let subpath = MODEL_CACHE_SUBPATH
  let requiredFiles = REQUIRED_MODEL_FILES
  try {
    const provenance = JSON.parse(fs.readFileSync(path.join(modelCacheDir, 'PROVENANCE.json'), 'utf8'))
    // Only trust provenance that is actually usable. A blank modelId or an empty
    // files array would otherwise make this gate a no-op and let a model-less
    // build ship, so fall back to the hardcoded safe defaults in those cases.
    if (typeof provenance.modelId === 'string' && provenance.modelId.trim().length > 0) {
      subpath = provenance.modelId.trim()
    }
    if (
      Array.isArray(provenance.files) &&
      provenance.files.length > 0 &&
      provenance.files.every((f) => typeof f === 'string' && f.trim().length > 0)
    ) {
      requiredFiles = provenance.files
    }
  } catch {
    // No/invalid provenance — fall back to the hardcoded list below.
  }

  const modelDir = path.join(modelCacheDir, subpath)
  const missing = requiredFiles.filter((f) => !isFile(path.join(modelDir, f)))

  if (missing.length > 0) {
    throw new Error(
      `[afterPack] bundle-before-flip gate FAILED: the embedding model is missing from the ` +
        `packaged app. Missing under ${modelDir}: ${missing.join(', ')}. ` +
        'Run `bun run provision-model` before packaging (dist/dist:dir do this automatically).'
    )
  }

  console.log(`[afterPack] embedding model present under Resources/model-cache (${requiredFiles.length} files).`)
}
