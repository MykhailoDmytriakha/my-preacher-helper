'use client';

import { useCallback, useEffect, useState } from 'react';

/** Gap between the app nav and a panel that sticks under it, and between that panel and the window's bottom. */
export const STICKY_PANEL_GAP_PX = 16;

/** Where a side panel that sticks under the app nav puts its top. */
export const stickyTopBelowNav = (navHeight: number): number => navHeight + STICKY_PANEL_GAP_PX;

/**
 * A callback ref that keeps a sticky side panel inside the window, top to bottom, by writing
 * the height left for it into `cssVar`.
 *
 * A sticky panel taller than the window, with no scroll of its own, freezes under the nav while
 * the page keeps moving: the wheel over it scrolls the other column and its bottom is out of
 * reach. Giving it a fixed "window minus nav" height is not enough either — before it sticks it
 * starts lower on the page, and that height pushes its bottom below the window. So the height is
 * exactly what is left between where the panel shows now and the window's bottom, re-measured
 * when the page scrolls, the window resizes, or the page above it changes height (a description
 * that grows while typing moves the panel without any scroll; a banner inserted above does too).
 * It is never more than that. When the window is shorter than the panel's current top plus its
 * header plus the gap, the header overflows the box until the page is scrolled; the header is not
 * a scroll area, so the wheel over it scrolls the page, and the panel grows as it rises.
 * The watched ancestors are taken when the ref attaches: React remounts a component it moves, so
 * a panel whose ancestors are re-parented by hand outside React is not supported.
 */
export function useWindowFittedPanel(top: number, cssVar: string) {
    return useCallback((element: HTMLElement | null) => {
        if (!element) return undefined;
        let frame = 0;
        const fit = () => {
            frame = 0;
            const shownTop = Math.max(element.getBoundingClientRect().top, top);
            const left = Math.floor(window.innerHeight - shownTop - STICKY_PANEL_GAP_PX);
            element.style.setProperty(cssVar, `${Math.max(0, left)}px`);
        };
        const schedule = () => {
            if (!frame) frame = window.requestAnimationFrame(fit);
        };
        fit();
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        // The panel moves without a scroll only when something before it in the page's flow
        // changes height or appears/disappears. So: watch the size of every earlier sibling of the
        // panel and of each ancestor, and watch each ancestor's children, re-collecting the earlier
        // siblings when one is inserted or removed (a banner appearing above the columns).
        const layout = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
        let watched = new Set<Element>();
        const watchWhatComesBefore = () => {
            if (!layout) return;
            const current = new Set<Element>();
            for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
                for (let before = node.previousElementSibling; before; before = before.previousElementSibling) {
                    current.add(before);
                    if (!watched.has(before)) layout.observe(before);
                }
            }
            // Blocks that left the page are let go, so a long session does not hold them.
            watched.forEach((gone) => {
                if (!current.has(gone)) layout.unobserve(gone);
            });
            watched = current;
        };
        layout?.observe(document.body);
        watchWhatComesBefore();
        const structure = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
            watchWhatComesBefore();
            schedule();
        });
        for (let node = element.parentElement; node; node = node === document.body ? null : node.parentElement) {
            structure?.observe(node, { childList: true });
        }
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            layout?.disconnect();
            structure?.disconnect();
        };
    }, [top, cssVar]);
}

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
