'use client';

import { useCallback, useEffect, useState } from 'react';

type ThemePreference = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'theme-preference';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

const isThemePreference = (value: unknown): value is ThemePreference =>
  value === 'light' || value === 'dark' || value === 'system';

const shouldApplyDark = (preference: ThemePreference, prefersDark: boolean) =>
  preference === 'dark' || (preference === 'system' && prefersDark);

/**
 * Owns the theme *preference* for the toggle UI: reads/persists the stored
 * choice and applies it when the user changes it.
 *
 * Live following of the OS theme (reacting to `prefers-color-scheme` changes and
 * device wake) is NOT this hook's job — that lives in the always-mounted
 * `ThemeWatcher` at the app root, so it works regardless of whether this hook
 * (mounted only inside `ThemeModeToggle`) is currently rendered.
 */
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

    const prefersDark =
      typeof window.matchMedia === 'function' ? window.matchMedia(MEDIA_QUERY).matches : false;
    html.classList.toggle('dark', shouldApplyDark(preference, prefersDark));
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
