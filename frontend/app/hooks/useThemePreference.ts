'use client';

import { useEffect, useState } from 'react';

import { applyTheme, saveThemePreference, themeChoice, type ThemePreference } from '@/utils/themePreference';

/** The toggle reads the current document's preference and saves only explicit selections. */
export function useThemePreference() {
  const { preference } = themeChoice.useChoice();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    applyTheme();
    setReady(true);
  }, []);

  return { preference, setPreference: saveThemePreference, ready };
}

export type { ThemePreference };
