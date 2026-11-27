'use client';

import { useEffect, useState } from 'react';

/**
 * Which section of the note is being read right now — the last one whose heading has
 * passed the sticky header. The outline highlights it, so the map always says where you
 * are; a table of contents that cannot answer that is half a table of contents.
 *
 * Deliberately a scroll listener over IntersectionObserver: sections nest, so several
 * are intersecting at once and "the innermost one above the fold" is the honest answer,
 * which observers make awkward to compute.
 */
/**
 * The section whose heading has last passed a line `offset` px under the top of `scrollRoot` (the window when none):
 * the rule the hook below follows on every scroll, and a screen asks once — the note page when the reading mode opens.
 */
export function sectionAtLine(offset: number, scrollRoot?: HTMLElement | null): string | null {
    const threshold = (scrollRoot?.getBoundingClientRect().top ?? 0) + offset + 1;
    let current: string | null = null;
    (scrollRoot ?? document).querySelectorAll<HTMLElement>('[data-section-id]').forEach((element) => {
        if (element.getBoundingClientRect().top <= threshold) {
            current = element.getAttribute('data-section-id');
        }
    });
    return current;
}

function activeReadingLine(offset: number, scrollRoot?: HTMLElement | null): number {
    const viewport = scrollRoot ?? document.scrollingElement;
    if (!viewport || viewport.scrollTop <= 0 || viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 1) {
        return offset;
    }
    // A short last section can be visible at the end without reaching the sticky header.
    // Scroll offsets can be fractional; the viewport and scroll heights are rounded.
    return Math.max(offset, viewport.clientHeight - 1);
}

export function useActiveSection(offset: number, enabled: boolean, resetKey?: string, scrollRoot?: HTMLElement | null): string | null {
    const [activeId, setActiveId] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled || typeof window === 'undefined') {
            setActiveId(null);
            return;
        }

        let frame = 0;
        const measure = () => {
            frame = 0;
            setActiveId(sectionAtLine(activeReadingLine(offset, scrollRoot), scrollRoot));
        };

        const onScroll = () => {
            if (frame) return;
            frame = window.requestAnimationFrame(measure);
        };

        measure();
        const scrollTarget = scrollRoot ?? window;
        scrollTarget.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        return () => {
            if (frame) window.cancelAnimationFrame(frame);
            scrollTarget.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onScroll);
        };
        // A different note or fold layout can change the section boxes at the same scroll position.
        // The caller's reset key lets us remeasure without waiting for another scroll event.
    }, [offset, enabled, resetKey, scrollRoot]);

    return activeId;
}
