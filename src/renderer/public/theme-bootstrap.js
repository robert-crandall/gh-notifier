// Apply the persisted theme to <html> before first paint to prevent a flash of
// the wrong color mode. Must stay in sync with useTheme.ts (same storage keys,
// same data-attributes, same system-resolution rule). Runtime updates are still
// owned by useTheme; this only handles the very first paint.
(function () {
  try {
    var COLOR_MODES = ['light', 'dark', 'dim', 'high-contrast', 'system'];
    var ACCENTS = ['slate', 'blue', 'green', 'violet'];
    var DENSITIES = ['compact', 'comfortable'];

    function read(key, allowed, fallback) {
      var v = localStorage.getItem(key);
      return v && allowed.indexOf(v) !== -1 ? v : fallback;
    }

    var mode = read('focus-color-mode', COLOR_MODES, 'system');
    var accent = read('focus-accent', ACCENTS, 'slate');
    var density = read('focus-density', DENSITIES, 'compact');

    // 'system' resolves to light/dark only; dim/high-contrast are explicit picks.
    var resolved = mode;
    if (mode === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    var el = document.documentElement;
    el.setAttribute('data-color-mode', resolved);
    el.setAttribute('data-accent', accent);
    el.setAttribute('data-density', density);
  } catch (e) {
    // If storage is unavailable, fall back to the CSS default (dark) — no crash.
  }
})();
