'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** One layout can only push the count around this many times before it is left alone. */
const MAX_ADJUSTMENTS = 4;

/**
 * How many rows a stretched panel can show.
 *
 * The dashboard lays its panels out in a grid row, and a grid row stretches every cell to
 * the height of the tallest one. So a panel's height is decided by its NEIGHBOUR, while the
 * length of its list used to be decided by a constant in the builder — the two never met,
 * and the shorter list sat above a third of a card of white space.
 *
 * This used to be a much longer hook: it measured every row, added rows in bulk by the
 * tallest one, probed for a shorter next row, remembered a ceiling so the probe could not
 * loop, and then spread the leftover inside the rows. All of that existed to cope with rows
 * of DIFFERENT heights. Give every row the same height and the apparatus collapses into one
 * division — the owner's idea, and it is better than what it replaced:
 *
 * - the count is exact rather than probed, so no row is refused because a taller sibling set
 *   the estimate;
 * - the leftover is identical in every panel of the row, because they divide the same height
 *   by the same row height, so the lists end level with no stretching at all;
 * - nothing measures a row it has itself resized, which is what froze an earlier version at
 *   three notes 175px tall each.
 *
 * `setPanelRef` and `setListRef` are CALLBACK refs for the same reason `useStickyOffsets`
 * uses one: the panels render after their data arrives, so a plain `useRef` is still empty
 * when the first effect runs and everything measures as zero.
 *
 * Where nothing stretches — a phone, where the panels are stacked one under another — the
 * available height is just the base rows, and the count stays what it always was.
 */
export function useFittingRows(baseCount: number, maxCount: number, rowHeight: number) {
    const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
    const [listEl, setListEl] = useState<HTMLElement | null>(null);
    const [visibleCount, setVisibleCount] = useState(baseCount);
    const adjustmentsRef = useRef(0);
    /** Width and item count together describe the layout this count was measured for. */
    const layoutRef = useRef('');

    const setPanelRef = useCallback((element: HTMLElement | null) => setPanelEl(element), []);
    const setListRef = useCallback((element: HTMLElement | null) => setListEl(element), []);

    useEffect(() => {
        if (typeof window === 'undefined' || !panelEl || !listEl || rowHeight <= 0) return;

        const px = (value: string) => {
            const parsed = parseFloat(value);
            return Number.isFinite(parsed) ? parsed : 0;
        };

        const measure = () => {
            const panelRect = panelEl.getBoundingClientRect();

            const layout = `${panelRect.width}x${maxCount}`;
            if (layout !== layoutRef.current) {
                layoutRef.current = layout;
                adjustmentsRef.current = 0;
            }
            if (adjustmentsRef.current >= MAX_ADJUSTMENTS) return;

            // The list's own padding is space the rows may not have: without subtracting it
            // the last row would be filled into the gap that keeps it off the card's border.
            // One panel keeps that padding on a wrapper around the list, and only its bottom
            // is missed there — the top is already inside the list's own top edge.
            const listStyle = window.getComputedStyle(listEl);
            const wrapper = listEl.parentElement;
            const wrapperBottom = wrapper && wrapper !== panelEl
                ? px(window.getComputedStyle(wrapper).paddingBottom)
                : 0;
            const inset = px(listStyle.paddingTop) + px(listStyle.paddingBottom) + wrapperBottom;
            const available = panelRect.bottom - listEl.getBoundingClientRect().top - inset;
            // No layout at all (server render, hidden tab): measuring would report "no room"
            // and freeze the list at its base count, which is exactly what it already shows.
            if (available <= 0) return;

            const fits = Math.floor(available / rowHeight);
            const clamped = Math.min(Math.max(fits, baseCount), maxCount);
            if (clamped === visibleCount) return;

            adjustmentsRef.current += 1;
            setVisibleCount(clamped);
        };

        measure();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', measure);
            return () => window.removeEventListener('resize', measure);
        }

        const observer = new ResizeObserver(measure);
        observer.observe(panelEl);
        observer.observe(listEl);
        return () => observer.disconnect();
    }, [panelEl, listEl, visibleCount, baseCount, maxCount, rowHeight]);

    return { setPanelRef, setListRef, visibleCount };
}
