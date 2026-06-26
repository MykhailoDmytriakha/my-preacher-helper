'use client';

import { useEffect } from 'react';

/**
 * Always-mounted, headless theme listener.
 *
 * The theme is applied on first load by the inline script in `layout.tsx`, but
 * that script only runs once per full page load. The live `matchMedia('change')`
 * listener used to live exclusively inside `useThemePreference` (consumed only by
 * `ThemeModeToggle`), which is mounted only while the profile dropdown / mobile
 * menu is open — so during normal use nothing listened for OS theme changes and
 * the app would not follow the system theme until a reload.
 *
 * This component mounts that listener globally at the app root. It reads the
 * stored preference fresh from localStorage on every change (no cached React
 * state), so it always honours the latest choice made via the toggle and never
 * fights it.
 */
const STORAGE_KEY = 'theme-preference';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';
// OS→browser propagation of a theme change can lag 50–500ms+ after device wake.
const WAKE_RETRY_DELAYS = [50, 300, 1000] as const;

type ThemePreference = 'light' | 'dark' | 'system';

const readPreference = (): ThemePreference => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
};

export function ThemeWatcher() {
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const mediaQuery = window.matchMedia(MEDIA_QUERY) as MediaQueryList & {
      addListener?: (listener: () => void) => void;
      removeListener?: (listener: () => void) => void;
    };

    const apply = () => {
      const preference = readPreference();
      const prefersDark = window.matchMedia(MEDIA_QUERY).matches;
      const shouldBeDark = preference === 'dark' || (preference === 'system' && prefersDark);
      document.documentElement.classList.toggle('dark', shouldBeDark);
    };

    const handleWake = () => {
      if (document.visibilityState === 'visible' || (document.hasFocus && document.hasFocus())) {
        WAKE_RETRY_DELAYS.forEach((delay) => setTimeout(apply, delay));
      }
    };

    // Re-sync once on mount in case the OS theme changed since the last full load.
    apply();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', apply);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(apply);
    }
    document.addEventListener('visibilitychange', handleWake);
    window.addEventListener('focus', handleWake);

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', apply);
      } else if (typeof mediaQuery.removeListener === 'function') {
        mediaQuery.removeListener(apply);
      }
      document.removeEventListener('visibilitychange', handleWake);
      window.removeEventListener('focus', handleWake);
    };
  }, []);

  return null;
}
