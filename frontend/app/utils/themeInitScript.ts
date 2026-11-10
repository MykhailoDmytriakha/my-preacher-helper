/**
 * The inline script that applies the saved theme before React hydrates, so the page never flashes
 * the wrong theme. Rendered verbatim into <head> by app/layout.tsx; kept in a module of its own so
 * its tests run this exact text, not a copy of its logic (BUG-20260929-tests-check-their-own-copy).
 */
export const THEME_STORAGE_KEY = 'theme-preference-v2';
export const LEGACY_THEME_STORAGE_KEY = 'theme-preference';
export const THEME_PREFERENCE_ATTRIBUTE = 'data-theme-preference';
export const THEME_BOOT_RECORD_ATTRIBUTE = 'data-theme-boot-record';

export const THEME_INIT_SCRIPT = `
(function() {
  try {
    var raw = localStorage.getItem('${THEME_STORAGE_KEY}');
    var record = null;
    try { record = JSON.parse(raw); } catch (e) {}
    var valid = record && (record.preference === 'light' || record.preference === 'dark' || record.preference === 'system')
      && typeof record.__savedAt === 'number' && Number.isFinite(record.__savedAt) && record.__savedAt > 0;
    var stored = valid ? record.preference : localStorage.getItem('${LEGACY_THEME_STORAGE_KEY}');
    var known = stored === 'light' || stored === 'dark' || stored === 'system';
    if (known) document.documentElement.setAttribute('${THEME_BOOT_RECORD_ATTRIBUTE}', valid ? raw : stored);
    var preference = known ? stored : 'system';
    var prefersDark = typeof window.matchMedia === 'function' 
      ? window.matchMedia('(prefers-color-scheme: dark)').matches 
      : false;
    var shouldBeDark = preference === 'dark' || (preference === 'system' && prefersDark);
    
    if (shouldBeDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    document.documentElement.setAttribute('${THEME_PREFERENCE_ATTRIBUTE}', preference);
  } catch (e) {}
})();
`;
