import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import path from 'path'

// The DB integration tests import the `bun:sqlite` builtin. Vite's resolver
// doesn't understand `bun:` specifiers, so mark them external and let whichever
// runtime executes the tests provide them (they run under Bun).
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
