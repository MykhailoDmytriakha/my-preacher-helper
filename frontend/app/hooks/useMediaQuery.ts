'use client';

import { useEffect, useState } from 'react';

/**
 * Whether a CSS media query matches, as a value React can branch on.
 *
 * Why JS and not a CSS breakpoint: a breakpoint can only hide one of two rendered
 * copies, and some of this page's blocks carry live inputs and pickers — two mounted
 * copies would mean two of each. This picks ONE thing to mount.
 *
 * `initial` is what the server rendered, so the first client paint matches it and the
 * effect corrects it immediately afterwards.
 */
export function useMediaQuery(query: string, initial = true): boolean {
    const [matches, setMatches] = useState(initial);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

        const mediaQuery = window.matchMedia(query);
        setMatches(mediaQuery.matches);

        const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', listener);
            return () => mediaQuery.removeEventListener('change', listener);
        }

        mediaQuery.addListener(listener);
        return () => mediaQuery.removeListener(listener);
    }, [query]);

    return matches;
}
