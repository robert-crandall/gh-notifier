/**
 * Custom ESLint plugin for project-specific rules
 */

const TAILWIND_COLOR_REGEX =
  /\b(bg|text|border|ring|from|via|to|fill|stroke|divide|placeholder|caret|accent|decoration|outline|shadow)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(50|100|200|300|400|500|600|700|800|900|950)\b|\b(bg|text|border|ring|from|via|to|fill|stroke|divide|placeholder|caret|accent|decoration|outline|shadow)-(white|black)\b/;

const SEMANTIC_COLORS_MESSAGE =
  'Use semantic color classes (bg-primary, text-foreground, etc.) instead of hardcoded Tailwind colors. See docs/color-system.md for available semantic colors.';

const DARK_MODE_COLORS_MESSAGE =
  'Use semantic colors instead of dark: variants for colors. Semantic colors automatically adapt to dark mode.';

// Regex to detect emojis (covers most common emoji ranges)
const EMOJI_REGEX =
  /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/u;

const USE_LUCIDE_MESSAGE =
  'Use Lucide icons instead of emojis or Material Symbols Outlined. Import from lucide-svelte (e.g., import { Heart } from "lucide-svelte").';

const SVELTEKIT_REDIRECT_IN_TRY_MESSAGE =
  'SvelteKit redirect() and error() throw exceptions and should not be called inside try blocks. The catch block will intercept them, preventing proper handling. Move the redirect/error call outside the try/catch, or use isRedirect()/isHttpError() in the catch block to re-throw them.';

// SvelteKit functions that throw exceptions
const SVELTEKIT_THROWING_FUNCTIONS = ['redirect', 'error'];

const PRIMARY_BG_REGEX = /(?:^|\s)bg-primary(?!\/)\b/;
const PRIMARY_FOREGROUND_REGEX = /(?:^|\s)text-primary-foreground\b/;
const PRIMARY_CONTRAST_MESSAGE =
  'Use text-primary-foreground with bg-primary to ensure accessible contrast.';

// Define the plugin with rules
const stylePlugin = {
  rules: {
    'no-hardcoded-colors': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Enforce semantic color classes instead of hardcoded Tailwind colors',
          category: 'Best Practices',
          recommended: true,
        },
        messages: {
          noHardcodedColors: SEMANTIC_COLORS_MESSAGE,
        },
      },
      create(context) {
        return {
          // Check string literals and template literals in JavaScript/TypeScript
          Literal(node) {
            if (typeof node.value === 'string' && TAILWIND_COLOR_REGEX.test(node.value)) {
              context.report({
                node,
                messageId: 'noHardcodedColors',
              });
            }
          },
          TemplateLiteral(node) {
            const templateValue = node.quasis.map((q) => q.value.raw).join('');
            if (TAILWIND_COLOR_REGEX.test(templateValue)) {
              context.report({
                node,
                messageId: 'noHardcodedColors',
              });
            }
          },
        };
      },
    },
    'no-dark-mode-colors': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow dark: variants with color utilities (use semantic colors instead)',
          category: 'Best Practices',
          recommended: true,
        },
        messages: {
          noDarkModeColors: DARK_MODE_COLORS_MESSAGE,
        },
      },
      create(context) {
        // Match dark: with color utilities like dark:bg-gray-800, dark:text-white, etc.
        const DARK_COLOR_REGEX =
          /\bdark:(bg|text|border|ring|from|via|to|fill|stroke|divide|placeholder|decoration|outline)-([\w-]+)/;

        return {
          Literal(node) {
            if (typeof node.value === 'string' && DARK_COLOR_REGEX.test(node.value)) {
              context.report({
                node,
                messageId: 'noDarkModeColors',
              });
            }
          },
          TemplateLiteral(node) {
            const templateValue = node.quasis.map((q) => q.value.raw).join('');
            if (DARK_COLOR_REGEX.test(templateValue)) {
              context.report({
                node,
                messageId: 'noDarkModeColors',
              });
            }
          },
        };
      },
    },
    'use-lucide-icons': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Enforce Lucide icons instead of emojis or Material Symbols Outlined',
          category: 'Best Practices',
          recommended: true,
        },
        messages: {
          useLucideIcons: USE_LUCIDE_MESSAGE,
        },
      },
      create(context) {
        return {
          // Check for emojis in string literals
          Literal(node) {
            if (typeof node.value === 'string' && EMOJI_REGEX.test(node.value)) {
              context.report({
                node,
                messageId: 'useLucideIcons',
              });
            }
          },
          // Check for emojis in template literals
          TemplateLiteral(node) {
            const templateValue = node.quasis.map((q) => q.value.raw).join('');
            if (EMOJI_REGEX.test(templateValue)) {
              context.report({
                node,
                messageId: 'useLucideIcons',
              });
            }
          },
        };
      },
    },
    'no-redirect-in-try': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow SvelteKit redirect() and error() calls inside try blocks',
          category: 'Possible Errors',
          recommended: true,
        },
        messages: {
          noRedirectInTry: SVELTEKIT_REDIRECT_IN_TRY_MESSAGE,
        },
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
              context.report({
                node,
                messageId: 'noRedirectInTry',
              });
            }
          },
        };
      },
    },
    'primary-bg-contrast': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Require text-primary-foreground whenever bg-primary is used',
          category: 'Accessibility',
          recommended: true,
        },
        messages: {
          primaryContrast: PRIMARY_CONTRAST_MESSAGE,
        },
      },
      create(context) {
        function checkString(value, node) {
          if (!/\s/.test(value)) {
            return;
          }
          if (PRIMARY_BG_REGEX.test(value) && !PRIMARY_FOREGROUND_REGEX.test(value)) {
            context.report({
              node,
              messageId: 'primaryContrast',
            });
          }
        }

        return {
          Literal(node) {
            if (typeof node.value === 'string') {
              checkString(node.value, node);
            }
          },
          TemplateLiteral(node) {
            const templateValue = node.quasis.map((q) => q.value.raw).join('');
            checkString(templateValue, node);
          },
        };
      },
    },
  },
};

// Export as flat config
export default {
  plugins: {
    'style-plugin': stylePlugin,
  },
  rules: {
    'style-plugin/no-hardcoded-colors': 'error',
    'style-plugin/no-dark-mode-colors': 'error',
    'style-plugin/use-lucide-icons': 'error',
    'style-plugin/no-redirect-in-try': 'error',
    'style-plugin/primary-bg-contrast': 'error',
  },
};
