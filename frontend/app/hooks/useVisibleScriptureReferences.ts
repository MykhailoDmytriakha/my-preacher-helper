'use client';

import { useEffect, useState } from 'react';

import { referenceOfLink, SCRIPTURE_REFERENCE_MARK } from '@/components/bible/ScriptureLinks';
import { sameScriptureReference } from '@/utils/scriptureReferenceNumbering';

import type { SheetReference } from '@/components/bible/verseSheetGeometry';

/**
 * THE SCRIPTURE PLACES THE READER SEES NOW, in one scrolling column (the reading mode's text).
 *
 * Read from the drawn links themselves (`SCRIPTURE_REFERENCE_MARK`), not from the source text: a place counts when its
 * link is on screen, and it is the same reference the link opens — whatever Markdown made of the text around it.
 * In the order the text names them, each once. A link in a folded section has no size and does not count.
 *
 * Measured on scroll (once a frame), on a resize, when the column's content changes size, and when `resetKey` (the
 * text) changes; a list that did not change draws nothing again.
 */
export function useVisibleScriptureReferences(scrollRoot: HTMLElement | null, enabled: boolean, resetKey?: string): SheetReference[] {
    const [visible, setVisible] = useState<SheetReference[]>([]);

    useEffect(() => {
        if (!scrollRoot || !enabled) {
            setVisible([]);
            return undefined;
        }
        let frame = 0;
        let last = '';
        const measure = () => {
            frame = 0;
            const box = scrollRoot.getBoundingClientRect();
            const found: SheetReference[] = [];
            scrollRoot.querySelectorAll(`[${SCRIPTURE_REFERENCE_MARK}]`).forEach((link) => {
                const rect = link.getBoundingClientRect();
                if (rect.height === 0 || rect.bottom <= box.top || rect.top >= box.bottom) return;
                const reference = referenceOfLink(link);
                if (reference && !found.some((known) => sameScriptureReference(known, reference))) found.push(reference);
            });
            const key = JSON.stringify(found);
            if (key === last) return;
            last = key;
            setVisible(found);
        };
        const schedule = () => {
            if (!frame) frame = window.requestAnimationFrame(measure);
        };

        measure();
        scrollRoot.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
        // The content and each of its columns: a text folding a section may not change the row's height when a margin
        // column is the taller one.
        const content = scrollRoot.firstElementChild;
        if (resize && content) [content, ...Array.from(content.children)].forEach((element) => resize.observe(element));
        return () => {
            if (frame) window.cancelAnimationFrame(frame);
            scrollRoot.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            resize?.disconnect();
        };
    }, [scrollRoot, enabled, resetKey]);

    return visible;
}
