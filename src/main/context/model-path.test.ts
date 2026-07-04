import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { isModelProvisioned, resolveModelProvisioning } from './model-path'
import { MODEL_CACHE_SUBPATH, REQUIRED_MODEL_FILES } from './embed'

/**
 * The packaged-vs-dev model-path resolution is the crux of offline loading, so
 * its branching (prod always-offline, dev present→offline, dev absent→remote) is
 * covered directly.
 */
describe('model-path resolution', () => {
  function tmp(prefix: string): string {
    return mkdtempSync(join(tmpdir(), prefix))
  }

  /** Writes all required model files into <cacheDir>/<subpath>/. */
  function provision(cacheDir: string): void {
    const modelDir = join(cacheDir, MODEL_CACHE_SUBPATH)
    for (const f of REQUIRED_MODEL_FILES) {
      const full = join(modelDir, f)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, 'x')
    }
  }

  describe('isModelProvisioned', () => {
    it('is false when the dir is empty', () => {
      expect(isModelProvisioned(tmp('mp-empty-'))).toBe(false)
    })

    it('is false when only some required files exist', () => {
      const dir = tmp('mp-partial-')
      const modelDir = join(dir, MODEL_CACHE_SUBPATH)
      mkdirSync(modelDir, { recursive: true })
      // Only the onnx present — the weak-probe trap: a single-file check would
      // wrongly call this provisioned.
      mkdirSync(join(modelDir, 'onnx'), { recursive: true })
      writeFileSync(join(modelDir, 'onnx', 'model.onnx'), 'x')
      expect(isModelProvisioned(dir)).toBe(false)
    })

    it('is true only when every required file exists', () => {
      const dir = tmp('mp-full-')
      provision(dir)
      expect(isModelProvisioned(dir)).toBe(true)
    })
  })

  describe('resolveModelProvisioning', () => {
    it('dev + model present → offline, cacheDir under the app path', () => {
      const appPath = tmp('mp-dev-present-')
      provision(join(appPath, '.model-cache'))
      const opts = resolveModelProvisioning({ isPackaged: false, getAppPath: () => appPath })
      expect(opts.allowRemoteModels).toBe(false)
      expect(opts.cacheDir).toBe(join(appPath, '.model-cache'))
    })

    it('dev + model absent → remote allowed (self-heal) with a warning', () => {
      const appPath = tmp('mp-dev-absent-')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const opts = resolveModelProvisioning({ isPackaged: false, getAppPath: () => appPath })
      expect(opts.allowRemoteModels).toBe(true)
      expect(opts.cacheDir).toBe(join(appPath, '.model-cache'))
      expect(warn).toHaveBeenCalledOnce()
      warn.mockRestore()
    })

    describe('packaged', () => {
      const original = process.resourcesPath
      beforeEach(() => {
        // process.resourcesPath is read-only-ish in some runtimes; define it for the test.
        Object.defineProperty(process, 'resourcesPath', { value: '/Applications/App.app/Contents/Resources', configurable: true })
      })
      afterEach(() => {
        Object.defineProperty(process, 'resourcesPath', { value: original, configurable: true })
      })

      it('always offline, cacheDir under resourcesPath — even if the model is absent (never touch the network)', () => {
        const opts = resolveModelProvisioning({ isPackaged: true, getAppPath: () => '/unused' })
        expect(opts.allowRemoteModels).toBe(false)
        expect(opts.cacheDir).toBe('/Applications/App.app/Contents/Resources/model-cache')
      })
    })
  })
})
