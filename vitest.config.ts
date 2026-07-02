import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import path from 'path'

// The DB integration tests import the `bun:sqlite` builtin and therefore require
// the Bun runtime. Vite's resolver doesn't understand `bun:` specifiers, so mark
// them external so Vite doesn't error while resolving; the runtime supplies the
// module. Under a Node-based `vitest run`, the `*.integration.test.ts` files can't
// import `bun:sqlite` and will fail — run the suite with Bun (matching this repo's
// existing bun:sqlite integration tests).
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
