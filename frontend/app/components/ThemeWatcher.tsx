'use client';

import { useEffect } from 'react';

import { applyTheme, themeChoice, THEME_MEDIA_QUERY } from '@/utils/themePreference';

// OS→browser propagation of a theme change can lag 50–500ms+ after device wake.
const WAKE_RETRY_DELAYS = [50, 300, 1000] as const;

/** Keep following the OS even when the theme toggle is closed. */
export function ThemeWatcher() {
  const { preference } = themeChoice.useChoice();
  useEffect(() => { applyTheme(); }, [preference]);

  useEffect(() => {
    const mediaQuery = typeof window.matchMedia === 'function' ? window.matchMedia(THEME_MEDIA_QUERY) : null;
    const handleWake = () => {
      if (document.visibilityState === 'visible' || (document.hasFocus && document.hasFocus())) {
        WAKE_RETRY_DELAYS.forEach((delay) => setTimeout(applyTheme, delay));
      }
    };

    if (typeof mediaQuery?.addEventListener === 'function') {
      mediaQuery.addEventListener('change', applyTheme);
    } else if (typeof mediaQuery?.addListener === 'function') {
      mediaQuery.addListener(applyTheme);
    }
    document.addEventListener('visibilitychange', handleWake);
    window.addEventListener('focus', handleWake);

    return () => {
      if (typeof mediaQuery?.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', applyTheme);
      } else if (typeof mediaQuery?.removeListener === 'function') {
        mediaQuery.removeListener(applyTheme);
      }
      document.removeEventListener('visibilitychange', handleWake);
      window.removeEventListener('focus', handleWake);
    };
  }, []);

  return null;
}
