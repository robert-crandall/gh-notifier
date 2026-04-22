// Apply theme before first paint to prevent flash of unstyled content
(function () {
  var supportedThemes = ['light', 'dark', 'nord', 'dracula', 'night', 'dim', 'corporate', 'lemonade'];
  var saved = localStorage.getItem('gh-projects-theme');
  var systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  var theme = supportedThemes.indexOf(saved) !== -1 ? saved : systemTheme;
  document.documentElement.setAttribute('data-theme', theme);
})();
