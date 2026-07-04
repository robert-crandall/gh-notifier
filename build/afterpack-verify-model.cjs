// electron-builder afterPack hook (build tooling — must be require()-able by the
// electron-builder node process, hence CommonJS .cjs rather than app TS source).
//
// The bundle-before-flip build gate: the packaged app forces the embedding model
// offline (`allowRemoteModels: false`), so a build that ships WITHOUT the bundled
// model would silently degrade to lexical-only forever. This hook FAILS the build
// if the provisioned model files didn't land under the app's Resources, so such a
// build can never be produced.
//
// The required-files list mirrors REQUIRED_MODEL_FILES / MODEL_CACHE_SUBPATH in
// src/main/context/embed.ts — keep them in sync.

const path = require('node:path')
const fs = require('node:fs')

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

  const modelDir = path.join(resourcesDir, 'model-cache', MODEL_CACHE_SUBPATH)
  const missing = REQUIRED_MODEL_FILES.filter((f) => !fs.existsSync(path.join(modelDir, f)))

  if (missing.length > 0) {
    throw new Error(
      `[afterPack] bundle-before-flip gate FAILED: the embedding model is missing from the ` +
        `packaged app. Missing under ${modelDir}: ${missing.join(', ')}. ` +
        'Run `bun run provision-model` before packaging (dist/dist:dir do this automatically).'
    )
  }

  console.log(`[afterPack] embedding model present under Resources/model-cache (${REQUIRED_MODEL_FILES.length} files).`)
}
