'use client';

import { useLayoutEffect, useRef } from 'react';

interface ReadingPosition {
    pane: HTMLElement;
    noteId: string;
    wide: boolean;
    anchor: HTMLElement | null;
    delta: number;
    offset: number;
}

/** Keep the same section and relative position when rotation changes scroll owners. */
export function useNoteScrollPosition(pane: HTMLElement | null, wide: boolean, noteId: string, createdNoteId?: string | null) {
    const saved = useRef<ReadingPosition | null>(null);

    useLayoutEffect(() => {
        if (!pane) return;
        const target = wide ? pane : window;
        const visibleTop = () => wide ? pane.getBoundingClientRect().top
            : pane.closest('[data-note-workspace]')?.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
        const contentOffset = () => Math.max(0, visibleTop() - pane.getBoundingClientRect().top + pane.scrollTop);
        const remember = () => {
            // CSS responds to rotation before matchMedia's React update. Ignore the
            // old owner's scroll reset during that gap rather than saving the top.
            if ((getComputedStyle(pane).overflowY === 'auto') !== wide) return;
            const top = visibleTop();
            const headings = Array.from(pane.querySelectorAll<HTMLElement>('[data-section-id]'));
            let anchor = headings[0] ?? null;
            for (const heading of headings) {
                if (heading.getBoundingClientRect().top <= top) anchor = heading;
            }
            saved.current = { pane, noteId, wide, anchor,
                delta: anchor ? anchor.getBoundingClientRect().top - top : 0,
                offset: contentOffset() };
        };

        const previous = saved.current;
        // Receiving an ID on first autosave continues the same open draft.
        const sameNote = previous?.noteId === noteId || (previous?.noteId === 'new' && noteId === createdNoteId);
        if (previous?.pane === pane && sameNote && previous.wide !== wide) {
            const anchor = previous.anchor;
            const delta = anchor && pane.contains(anchor)
                ? anchor.getBoundingClientRect().top - visibleTop() - previous.delta
                : previous.offset - contentOffset();
            target.scrollBy({ top: delta, behavior: 'instant' });
        } else if (previous && !sameNote) {
            target.scrollTo({ top: 0, behavior: 'instant' });
        }
        remember();
        target.addEventListener('scroll', remember, { passive: true });
        return () => target.removeEventListener('scroll', remember);
    }, [pane, wide, noteId, createdNoteId]);
}
