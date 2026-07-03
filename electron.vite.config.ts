import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    // Bundle these into the main output instead of leaving them as runtime
    // require() calls:
    //   - @octokit/* are ESM-only, so an externalized require() fails at runtime.
    //   - ws is pure JS; inlining it means the packaged app never does
    //     require('ws'), so it can't crash with "Cannot find module 'ws'" when
    //     electron-builder happens to omit it from app.asar (e.g. stale
    //     node_modules). See build.rollupOptions.external below for ws's optional
    //     native addons.
    plugins: [externalizeDepsPlugin({ exclude: [
      '@octokit/auth-token',
      '@octokit/core',
      '@octokit/endpoint',
      '@octokit/graphql',
      '@octokit/openapi-types',
      '@octokit/plugin-paginate-rest',
      '@octokit/plugin-request-log',
      '@octokit/plugin-rest-endpoint-methods',
      '@octokit/request',
      '@octokit/request-error',
      '@octokit/rest',
      '@octokit/types',
      'ws',
    ] })],
    build: {
      rollupOptions: {
        // ws lazily requires these optional native addons inside try/catch and
        // falls back to pure JS when they're absent. Keep them external so the
        // bundle doesn't try to resolve modules we don't ship.
        external: ['bufferutil', 'utf-8-validate']
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
