'use client';

import { useEffect } from 'react';

const REGION_SELECTOR = '[data-note-scroll-region]';

function scrollOwner(hit: Element, region: HTMLElement): HTMLElement | null {
    // Keep editor textareas and other nested scrollers usable in their own right.
    for (let node = hit; node !== region; node = node.parentElement!) {
        if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight
            && /^(auto|scroll)$/.test(getComputedStyle(node).overflowY)) return node;
    }
    return region.dataset.noteScrollRegion === 'panel'
        ? region
        : document.scrollingElement as HTMLElement | null;
}

function wheelDistance(event: WheelEvent, owner: HTMLElement): number {
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * owner.clientHeight;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        const style = getComputedStyle(owner);
        const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2 || 16;
        return event.deltaY * lineHeight;
    }
    return event.deltaY;
}

/**
 * Wheel transactions can retain their original target after the pointer crosses panes.
 * Route desktop wheel deltas by hit testing instead, before native scrolling can latch
 * or chain into the other pane. Hardware momentum supplies its own incremental deltas;
 * adding a smooth scroll animation here would keep the previous pane moving again.
 */
export function useNoteScrollIsolation(root: HTMLElement | null, enabled: boolean) {
    useEffect(() => {
        if (!root || !enabled) return;

        const onWheel = (event: WheelEvent) => {
            if (event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey || event.shiftKey
                || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

            const hit = document.elementFromPoint(event.clientX, event.clientY);
            if (!hit || !root.contains(hit) || hit.closest('input, select, [role="listbox"], [role="menu"], [role="slider"]')) return;
            const region = hit.closest<HTMLElement>(REGION_SELECTOR);
            if (!region || !root.contains(region)) return;
            const owner = scrollOwner(hit, region);
            if (!owner) return;

            // Also cancel at a boundary: the outline must never scroll the document.
            event.preventDefault();
            owner.scrollBy({ top: wheelDistance(event, owner), behavior: 'instant' });
        };

        root.addEventListener('wheel', onWheel, { passive: false });
        return () => root.removeEventListener('wheel', onWheel);
    }, [root, enabled]);
}
