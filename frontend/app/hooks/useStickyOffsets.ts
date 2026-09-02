'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Where the note page's sticky layers belong, measured rather than assumed.
 *
 * The app's own nav is sticky at the top of every page, and the note's action bar has to
 * sit directly under it — a hardcoded height was wrong the moment the nav laid out
 * differently on a phone (65px on a desktop, 61 on mobile), and page text showed through
 * the gap between the two bars. The note header changes height too, whenever a long
 * title wraps onto its own row.
 *
 * `setHeaderEl` is a CALLBACK ref on purpose. The page renders a loading spinner before
 * the note arrives, so a plain `useRef` is still empty when the effect first runs, and
 * the effect never re-runs — the header measured as zero and everything stacked at the
 * nav's height. A callback ref fires when the element actually appears.
 */
export function useStickyOffsets() {
    const [headerEl, setHeaderEl] = useState<HTMLElement | null>(null);
    const [navHeight, setNavHeight] = useState(0);
    const [headerHeight, setHeaderHeight] = useState(0);

    const setHeaderRef = useCallback((element: HTMLElement | null) => setHeaderEl(element), []);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const nav = document.querySelector<HTMLElement>('nav');

        const measure = () => {
            setNavHeight(nav ? Math.round(nav.getBoundingClientRect().height) : 0);
            setHeaderHeight(headerEl ? Math.round(headerEl.getBoundingClientRect().height) : 0);
        };

        measure();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', measure);
            return () => window.removeEventListener('resize', measure);
        }

        const observer = new ResizeObserver(measure);
        if (nav) observer.observe(nav);
        if (headerEl) observer.observe(headerEl);
        return () => observer.disconnect();
    }, [headerEl]);

    return { setHeaderRef, navHeight, belowHeader: navHeight + headerHeight };
}
