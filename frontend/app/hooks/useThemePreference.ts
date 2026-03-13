'use client';

import { useCallback, useEffect, useState } from 'react';

type ThemePreference = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'theme-preference';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

const isThemePreference = (value: unknown): value is ThemePreference =>
  value === 'light' || value === 'dark' || value === 'system';

const shouldApplyDark = (preference: ThemePreference, prefersDark: boolean) =>
  preference === 'dark' || (preference === 'system' && prefersDark);

export function useThemePreference() {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isThemePreference(stored)) {
      setPreferenceState(stored);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORAGE_KEY, preference);
  }, [preference, ready]);

  useEffect(() => {
    if (!ready) return;
    const html = document.documentElement;
    html.setAttribute('data-theme-preference', preference);

    if (typeof window.matchMedia !== 'function') {
      html.classList.toggle('dark', preference === 'dark');
      return;
    }

    const mediaQuery = window.matchMedia(MEDIA_QUERY) as MediaQueryList & {
      addListener?: (listener: (this: MediaQueryList, ev: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (this: MediaQueryList, ev: MediaQueryListEvent) => void) => void;
    };
    const applyTheme = () => {
      const shouldUseDark = shouldApplyDark(preference, mediaQuery.matches);
      html.classList.toggle('dark', shouldUseDark);
    };

    applyTheme();

    if (preference === 'system') {
      const handleChange = () => applyTheme();

      // Re-apply theme when device wakes from sleep (visibilitychange fires,
      // but matchMedia 'change' may not if the OS changed theme while asleep)
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          applyTheme();
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleChange);
        return () => {
          mediaQuery.removeEventListener('change', handleChange);
          document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
      }

      if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handleChange);
        return () => {
          mediaQuery.removeListener?.(handleChange);
          document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
      }

      document.removeEventListener('visibilitychange', handleVisibilityChange);
      return undefined;
    }

    return undefined;
  }, [preference, ready]);

  const setPreference = useCallback((value: ThemePreference) => {
    setPreferenceState(value);
  }, []);

  return {
    preference,
    setPreference,
    ready,
  };
}

export type { ThemePreference };
