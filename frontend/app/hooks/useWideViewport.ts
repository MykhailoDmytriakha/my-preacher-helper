'use client';

import { useEffect, useState } from 'react';

/** Tailwind's `lg` breakpoint — where the note page has room for a side panel. */
const WIDE_QUERY = '(min-width: 1024px)';

/**
 * True when the viewport is wide enough for the note's side panel.
 *
 * Why JS and not just a CSS breakpoint: the panel and the narrow layout must not both
 * render the note's metadata blocks — those carry inputs and pickers, and two live
 * copies would mean two of each. The flag picks ONE place to mount them.
 *
 * Starts `true` so it matches what the server rendered; a narrow client corrects it on
 * the first effect.
 */
export function useWideViewport(): boolean {
    const [isWide, setIsWide] = useState(true);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

        const mediaQuery = window.matchMedia(WIDE_QUERY);
        setIsWide(mediaQuery.matches);

        const listener = (event: MediaQueryListEvent) => setIsWide(event.matches);
        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', listener);
            return () => mediaQuery.removeEventListener('change', listener);
        }

        mediaQuery.addListener(listener);
        return () => mediaQuery.removeListener(listener);
    }, []);

    return isWide;
}
