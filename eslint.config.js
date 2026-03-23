import sveltePlugin from 'eslint-plugin-svelte';
import tsParser from '@typescript-eslint/parser';
import svelteParser from 'svelte-eslint-parser';
import globals from 'globals';
import stylePlugin from './eslint-style.js';

// ─── Flat config export ───────────────────────────────────────────────────────

// ─── Flat config export ───────────────────────────────────────────────────────

export default [
  // ── Ignore build artefacts ──────────────────────────────────────────────────
  {
    ignores: ['build/**', '.svelte-kit/**', 'src-tauri/**', 'node_modules/**'],
  },

  // ── TypeScript / JS files ───────────────────────────────────────────────────
  {
    files: ['**/*.ts', '**/*.js'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: './tsconfig.json', extraFileExtensions: ['.svelte'] },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { style: stylePlugin },
    rules: {
      'style/no-hardcoded-colors': 'error',
      'style/no-dark-mode-colors': 'error',
      'style/no-emoji': 'error',
      'style/no-redirect-in-try': 'error',
      'style/m3-on-primary-contrast': 'warn',
    },
  },

  // ── Svelte files ────────────────────────────────────────────────────────────
  ...sveltePlugin.configs['flat/recommended'].map((config) => ({
    ...config,
    files: ['**/*.svelte'],
  })),
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tsParser,
        project: './tsconfig.json',
        extraFileExtensions: ['.svelte'],
      },
      globals: { ...globals.browser },
    },
    plugins: { style: stylePlugin },
    rules: {
      // Disabled: this is a static SPA (Tauri + static adapter). goto() does
      // not go through a SvelteKit server, so SSR-resolve checking is N/A.
      'svelte/no-navigation-without-resolve': 'off',
      'style/no-hardcoded-colors': 'error',
      'style/no-dark-mode-colors': 'error',
      'style/no-emoji': 'error',
      'style/no-redirect-in-try': 'error',
      'style/m3-on-primary-contrast': 'warn',
    },
  },
];
