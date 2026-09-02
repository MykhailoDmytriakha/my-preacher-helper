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
export function useActiveSection(offset: number, enabled: boolean): string | null {
    const [activeId, setActiveId] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled || typeof window === 'undefined') {
            setActiveId(null);
            return;
        }

        let frame = 0;
        const measure = () => {
            frame = 0;
            let current: string | null = null;
            document.querySelectorAll<HTMLElement>('[data-section-id]').forEach((element) => {
                if (element.getBoundingClientRect().top <= offset + 1) {
                    current = element.getAttribute('data-section-id');
                }
            });
            setActiveId(current);
        };

        const onScroll = () => {
            if (frame) return;
            frame = window.requestAnimationFrame(measure);
        };

        measure();
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        return () => {
            if (frame) window.cancelAnimationFrame(frame);
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onScroll);
        };
    }, [offset, enabled]);

    return activeId;
}
