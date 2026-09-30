/**
 * The inline script that applies the saved theme before React hydrates, so the page never flashes
 * the wrong theme. Rendered verbatim into <head> by app/layout.tsx; kept in a module of its own so
 * its tests run this exact text, not a copy of its logic (BUG-20260929-tests-check-their-own-copy).
 */
export const THEME_INIT_SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem('theme-preference');
    var preference = (stored === 'light' || stored === 'dark' || stored === 'system') ? stored : 'system';
    var prefersDark = typeof window.matchMedia === 'function' 
      ? window.matchMedia('(prefers-color-scheme: dark)').matches 
      : false;
    var shouldBeDark = preference === 'dark' || (preference === 'system' && prefersDark);
    
    if (shouldBeDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    document.documentElement.setAttribute('data-theme-preference', preference);
  } catch (e) {}
})();
`;
