import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import path from 'path'

// Vitest runs under the Bun runtime, which provides the `bun:sqlite` builtin used by
// the DB integration tests. Vite's resolver doesn't know `bun:` specifiers, so mark
// them external and let the runtime supply them.
function externalizeBunBuiltins(): Plugin {
  return {
    name: 'externalize-bun-builtins',
    enforce: 'pre',
    resolveId(id) {
      if (id.startsWith('bun:')) {
        return { id, external: true }
      }
      return null
    },
  }
}

export default defineConfig({
  plugins: [externalizeBunBuiltins()],
  test: {
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    environmentMatchGlobs: [
      ['src/renderer/**', 'jsdom'],
    ],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
})
