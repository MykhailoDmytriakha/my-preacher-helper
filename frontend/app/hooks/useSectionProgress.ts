'use client';

import { useEffect, useState } from 'react';

export type SectionProgress = {
    /** For each section id, how much of it has passed the reading line: 0 — not reached, 1 — read through. */
    bySection: Record<string, number>;
    /** How far down the whole column the reader has scrolled, 0 to 1. */
    overall: number;
};

const NONE: SectionProgress = { bySection: {}, overall: 0 };
const clamp = (value: number) => Math.min(1, Math.max(0, value));
/** Bars are drawn in whole percents: a scroll that moves nothing visible draws nothing again. */
const step = (value: number) => Math.round(clamp(value) * 100) / 100;
const same = (a: SectionProgress, b: SectionProgress) =>
    a.overall === b.overall && Object.keys(b.bySection).length === Object.keys(a.bySection).length
    && Object.entries(b.bySection).every(([id, value]) => a.bySection[id] === value);

/**
 * HOW MUCH OF EACH SECTION HAS BEEN READ, in one scrolling column (the reading mode's text).
 *
 * The reading line is half way down the column: a section counts as read up to the part of it that
 * has risen above that line, and a section ends where the next one begins. At the very bottom of
 * the column everything above has been read, even a last section too short to reach the line.
 *
 * Sections are found by `data-section-id` inside `scrollRoot` only — the reading mode draws the note
 * over its own page, so the same ids exist twice in the document.
 */
export function useSectionProgress(scrollRoot: HTMLElement | null, sectionIds: readonly string[], resetKey?: string): SectionProgress {
    const [progress, setProgress] = useState<SectionProgress>(NONE);
    const idsKey = sectionIds.join('|');

    useEffect(() => {
        if (!scrollRoot) {
            setProgress(NONE);
            return undefined;
        }
        const ids = idsKey ? idsKey.split('|') : [];
        let frame = 0;
        let last: SectionProgress | null = null;
        const measure = () => {
            frame = 0;
            const rootTop = scrollRoot.getBoundingClientRect().top;
            const view = scrollRoot.clientHeight;
            const line = rootTop + view / 2;
            const contentBottom = rootTop + scrollRoot.scrollHeight - scrollRoot.scrollTop;
            // One query for every section of the column, the first element of each id kept.
            const found = new Map<string, Element>();
            scrollRoot.querySelectorAll('[data-section-id]').forEach((element) => {
                const id = element.getAttribute('data-section-id');
                if (id && !found.has(id)) found.set(id, element);
            });
            const tops = ids.map((id) => found.get(id)?.getBoundingClientRect().top ?? null);
            const max = scrollRoot.scrollHeight - view;
            const atEnd = max <= 0 || scrollRoot.scrollTop >= max - 2;
            const bySection: Record<string, number> = {};
            // From the last section up: each ends where the next drawn one begins.
            let next = contentBottom;
            for (let index = ids.length - 1; index >= 0; index -= 1) {
                const top = tops[index];
                if (top === null) {
                    bySection[ids[index]] = 0;
                    continue;
                }
                bySection[ids[index]] = atEnd ? 1 : step((line - top) / Math.max(1, next - top));
                next = top;
            }
            const measured = { bySection, overall: max > 0 ? step(scrollRoot.scrollTop / max) : 1 };
            if (last && same(last, measured)) return;
            last = measured;
            setProgress(measured);
        };
        const schedule = () => {
            if (!frame) frame = window.requestAnimationFrame(measure);
        };

        measure();
        scrollRoot.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        // A section folded or opened, or the text size changed: the heights move without a scroll.
        const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
        if (resize && scrollRoot.firstElementChild) resize.observe(scrollRoot.firstElementChild);
        return () => {
            if (frame) window.cancelAnimationFrame(frame);
            scrollRoot.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            resize?.disconnect();
        };
    }, [scrollRoot, idsKey, resetKey]);

    return progress;
}
