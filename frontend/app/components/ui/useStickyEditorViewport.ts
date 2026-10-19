'use client';

import { useLayoutEffect, useState } from 'react';

import type { EditorProps } from '@tiptap/pm/view';

/** Inform native caret scrolling of the opt-in toolbar without owning page scroll. */
export function useStickyEditorViewport(stickyTop?: number) {
    const [toolbar, toolbarRef] = useState<HTMLDivElement | null>(null);
    const [height, setHeight] = useState(0);

    useLayoutEffect(() => {
        if (!toolbar || stickyTop === undefined) return;
        const measure = () => setHeight(toolbar.getBoundingClientRect().height);
        measure();
        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', measure);
            return () => window.removeEventListener('resize', measure);
        }
        const observer = new ResizeObserver(measure);
        observer.observe(toolbar);
        return () => observer.disconnect();
    }, [toolbar, stickyTop]);

    const top = stickyTop === undefined ? undefined : Math.max(0, stickyTop + height);
    // Explicit undefined clears prior options: ProseMirror setProps merges keys.
    // Other edges retain the native threshold (0) and margin (5).
    const scrollProps: Pick<EditorProps, 'scrollThreshold' | 'scrollMargin'> = {
        scrollThreshold: top === undefined ? undefined : { top, right: 0, bottom: 0, left: 0 },
        scrollMargin: top === undefined ? undefined : { top: top + 5, right: 5, bottom: 5, left: 5 },
    };
    return { toolbarRef: stickyTop === undefined ? undefined : toolbarRef, scrollProps };
}
