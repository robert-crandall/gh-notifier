import sveltePlugin from 'eslint-plugin-svelte';
import tsParser from '@typescript-eslint/parser';
import svelteParser from 'svelte-eslint-parser';
import globals from 'globals';

// ─── Custom style rules ───────────────────────────────────────────────────────

// Raw Tailwind palette classes (e.g. bg-blue-500, text-red-700, border-gray-300).
// All colors must come from the semantic M3 tokens defined in tailwind.config.js.
const TAILWIND_COLOR_REGEX =
  /\b(bg|text|border|ring|from|via|to|fill|stroke|divide|placeholder|caret|accent|decoration|outline|shadow)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(50|100|200|300|400|500|600|700|800|900|950)\b|\b(bg|text|border|ring|from|via|to|fill|stroke|divide|placeholder|caret|accent|decoration|outline|shadow)-(white|black)\b/;

const NO_HARDCODED_COLORS_MESSAGE =
  'Use semantic M3 color tokens (e.g. bg-surface, text-on-primary, border-outline-variant) ' +
  'instead of raw Tailwind palette colors. See tailwind.config.js for available tokens.';

// dark: color variants are unnecessary — the M3 tokens automatically express
// both light and dark values via CSS custom properties.
const DARK_COLOR_REGEX =
  /\bdark:(bg|text|border|ring|from|via|to|fill|stroke|divide|placeholder|decoration|outline)-([\w-]+)/;

const NO_DARK_MODE_COLORS_MESSAGE =
  'Use semantic M3 color tokens instead of dark: color variants. ' +
  'M3 tokens adapt automatically to the active theme.';

// Emojis in source/templates should be replaced with Material Symbols Outlined
// (loaded via Google Fonts CDN in app.html).
const EMOJI_REGEX =
  /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/u;

const NO_EMOJI_MESSAGE =
  'Use Material Symbols Outlined icons instead of emojis. ' +
  'Add a <span class="material-symbols-outlined">icon_name</span> element.';

// SvelteKit redirect() and error() throw exceptions — they must not be wrapped
// in try/catch or the catch block will swallow them.
const SVELTEKIT_REDIRECT_IN_TRY_MESSAGE =
  'SvelteKit redirect() and error() throw exceptions. Do not call them inside a try block. ' +
  'Move the call outside the try/catch, or re-throw using isRedirect() / isHttpError() in catch.';

const SVELTEKIT_THROWING_FUNCTIONS = ['redirect', 'error'];

// M3 contrast pairing: bg-primary requires text-on-primary for accessible contrast.
const PRIMARY_BG_REGEX = /(?:^|\s)bg-primary(?!\/)\b/;
const ON_PRIMARY_REGEX = /(?:^|\s)text-on-primary\b/;
const M3_CONTRAST_MESSAGE =
  'Use text-on-primary alongside bg-primary to maintain M3 accessible contrast.';

// ─── Plugin definition ────────────────────────────────────────────────────────

/** @type {import('eslint').ESLint.Plugin} */
const stylePlugin = {
  rules: {
    'no-hardcoded-colors': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Enforce semantic M3 color tokens instead of raw Tailwind palette classes',
          category: 'Best Practices',
          recommended: true,
        },
        messages: { noHardcodedColors: NO_HARDCODED_COLORS_MESSAGE },
      },
      create(context) {
        return {
          Literal(node) {
            if (typeof node.value === 'string' && TAILWIND_COLOR_REGEX.test(node.value)) {
              context.report({ node, messageId: 'noHardcodedColors' });
            }
          },
          TemplateLiteral(node) {
            const raw = node.quasis.map((q) => q.value.raw).join('');
            if (TAILWIND_COLOR_REGEX.test(raw)) {
              context.report({ node, messageId: 'noHardcodedColors' });
            }
          },
        };
      },
    },

    'no-dark-mode-colors': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow dark: color variants — use M3 semantic tokens instead',
          category: 'Best Practices',
          recommended: true,
        },
        messages: { noDarkModeColors: NO_DARK_MODE_COLORS_MESSAGE },
      },
      create(context) {
        return {
          Literal(node) {
            if (typeof node.value === 'string' && DARK_COLOR_REGEX.test(node.value)) {
              context.report({ node, messageId: 'noDarkModeColors' });
            }
          },
          TemplateLiteral(node) {
            const raw = node.quasis.map((q) => q.value.raw).join('');
            if (DARK_COLOR_REGEX.test(raw)) {
              context.report({ node, messageId: 'noDarkModeColors' });
            }
          },
        };
      },
    },

    'no-emoji': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow emojis in source — use Material Symbols Outlined instead',
          category: 'Best Practices',
          recommended: true,
        },
        messages: { noEmoji: NO_EMOJI_MESSAGE },
      },
      create(context) {
        return {
          Literal(node) {
            if (typeof node.value === 'string' && EMOJI_REGEX.test(node.value)) {
              context.report({ node, messageId: 'noEmoji' });
            }
          },
          TemplateLiteral(node) {
            const raw = node.quasis.map((q) => q.value.raw).join('');
            if (EMOJI_REGEX.test(raw)) {
              context.report({ node, messageId: 'noEmoji' });
            }
          },
        };
      },
    },

    'no-redirect-in-try': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow SvelteKit redirect() and error() inside try blocks',
          category: 'Possible Errors',
          recommended: true,
        },
        messages: { noRedirectInTry: SVELTEKIT_REDIRECT_IN_TRY_MESSAGE },
      },
      create(context) {
        let tryDepth = 0;
        return {
          TryStatement() {
            tryDepth++;
          },
          'TryStatement:exit'() {
            tryDepth--;
          },
          CallExpression(node) {
            if (
              tryDepth > 0 &&
              node.callee.type === 'Identifier' &&
              SVELTEKIT_THROWING_FUNCTIONS.includes(node.callee.name)
            ) {
              context.report({ node, messageId: 'noRedirectInTry' });
            }
          },
        };
      },
    },

    'm3-on-primary-contrast': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Require text-on-primary whenever bg-primary is used (M3 contrast pairing)',
          category: 'Accessibility',
          recommended: true,
        },
        messages: { m3Contrast: M3_CONTRAST_MESSAGE },
      },
      create(context) {
        /**
         * Only meaningful on multi-class strings (a single-class string can't
         * contain both bg-primary and text-on-primary simultaneously).
         */
        function check(value, node) {
          if (!/\s/.test(value)) return;
          if (PRIMARY_BG_REGEX.test(value) && !ON_PRIMARY_REGEX.test(value)) {
            context.report({ node, messageId: 'm3Contrast' });
          }
        }
        return {
          Literal(node) {
            if (typeof node.value === 'string') check(node.value, node);
          },
          TemplateLiteral(node) {
            check(node.quasis.map((q) => q.value.raw).join(''), node);
          },
        };
      },
    },
  },
};

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
