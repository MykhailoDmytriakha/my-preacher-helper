'use client';

import { useState, useEffect } from 'react';

/**
 * Hook to detect if a CSS media query matches.
 * SSR-safe - returns false during server-side rendering.
 *
 * @param query - CSS media query string, e.g., '(max-width: 767px)'
 * @returns boolean indicating if the query matches
 *
 * @example
 * const isMobile = useMediaQuery('(max-width: 767px)');
 * const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
 */
export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(false);

    useEffect(() => {
        // Check if window is available (client-side)
        if (typeof window === 'undefined') return;

        const mediaQuery = window.matchMedia(query);

        // Set initial value
        setMatches(mediaQuery.matches);

        // Handler for changes
        const handleChange = (event: MediaQueryListEvent) => {
            setMatches(event.matches);
        };

        // Modern browsers
        mediaQuery.addEventListener('change', handleChange);

        return () => {
            mediaQuery.removeEventListener('change', handleChange);
        };
    }, [query]);

    return matches;
}
