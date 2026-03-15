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
      // Re-evaluate the media query locally to ensure we get the freshest value
      // This is crucial after device wake-up where the outer closure's mediaQuery object might be stale.
      const freshMediaQueryMatches = window.matchMedia(MEDIA_QUERY).matches;
      const shouldUseDark = shouldApplyDark(preference, freshMediaQueryMatches);
      html.classList.toggle('dark', shouldUseDark);
    };

    applyTheme();

    if (preference === 'system') {
      const handleChange = () => applyTheme();

      // Re-apply theme when device wakes from sleep or tab regains focus
      // (visibilitychange fires, but matchMedia 'change' may not if the OS changed theme while asleep)
      const handleWakeEvent = () => {
        if (
          document.visibilityState === 'visible' ||
          (document.hasFocus && document.hasFocus())
        ) {
          // Add a tiny delay because OS->Browser theme propagation might not be instant on wake
          setTimeout(() => {
            applyTheme();
          }, 50);
        }
      };

      document.addEventListener('visibilitychange', handleWakeEvent);
      window.addEventListener('focus', handleWakeEvent);

      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleChange);
        return () => {
          mediaQuery.removeEventListener('change', handleChange);
          document.removeEventListener('visibilitychange', handleWakeEvent);
          window.removeEventListener('focus', handleWakeEvent);
        };
      }

      if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handleChange);
        return () => {
          mediaQuery.removeListener?.(handleChange);
          document.removeEventListener('visibilitychange', handleWakeEvent);
          window.removeEventListener('focus', handleWakeEvent);
        };
      }

      document.removeEventListener('visibilitychange', handleWakeEvent);
      window.removeEventListener('focus', handleWakeEvent);
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
