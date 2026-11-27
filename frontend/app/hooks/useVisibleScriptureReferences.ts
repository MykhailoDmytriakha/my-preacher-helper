'use client';

import { useEffect, useState } from 'react';

import { referenceOfLink, SCRIPTURE_REFERENCE_MARK } from '@/components/bible/ScriptureLinks';
import { sameScriptureReference } from '@/utils/scriptureReferenceNumbering';

import type { SheetReference } from '@/components/bible/verseSheetGeometry';

type ObservedReference = {
    mark: string;
    reference: SheetReference;
    visible: boolean;
};

/**
 * Read the references from the drawn links. Observe them relative to the reading scroller,
 * so a nested table (or another clipping container) also limits what reaches the margin.
 */
export function useVisibleScriptureReferences(
    scrollRoot: HTMLElement | null, textRoot: HTMLElement | null, enabled: boolean,
): SheetReference[] {
    const [visible, setVisible] = useState<SheetReference[]>([]);

    useEffect(() => {
        if (!scrollRoot || !textRoot || !enabled || typeof IntersectionObserver === 'undefined') {
            setVisible(previous => previous.length ? [] : previous);
            return;
        }

        let links = new Map<Element, ObservedReference>();
        let last = '';
        const publish = () => {
            const found: SheetReference[] = [];
            for (const entry of links.values()) {
                if (entry.visible && !found.some(known => sameScriptureReference(known, entry.reference))) {
                    found.push(entry.reference);
                }
            }
            const key = JSON.stringify(found);
            if (key === last) return;
            last = key;
            setVisible(found);
        };

        const intersections = new IntersectionObserver(entries => {
            let changed = false;
            for (const entry of entries) {
                const link = links.get(entry.target);
                if (!link) continue;
                const drawn = entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0;
                if (link.visible === drawn) continue;
                link.visible = drawn;
                changed = true;
            }
            if (changed) publish();
        // At threshold zero an edge-touching link can already be intersecting. A positive
        // threshold also notifies us when its visible area changes between zero and nonzero.
        }, { root: scrollRoot, threshold: Number.EPSILON });

        const reconcile = () => {
            // Rebuild the order after DOM changes, retaining parsed references and observations
            // for the same nodes. Mutation tracking is confined to the text, outside the margin.
            const next = new Map<Element, ObservedReference>();
            for (const target of textRoot.querySelectorAll(`[${SCRIPTURE_REFERENCE_MARK}]`)) {
                const previous = links.get(target);
                const mark = target.getAttribute(SCRIPTURE_REFERENCE_MARK) ?? '';
                if (previous?.mark === mark) {
                    next.set(target, previous);
                    continue;
                }
                const reference = referenceOfLink(target);
                if (!reference) continue;
                next.set(target, { mark, reference, visible: previous?.visible ?? false });
                if (!previous) intersections.observe(target);
            }
            for (const target of links.keys()) {
                if (!next.has(target)) intersections.unobserve(target);
            }
            links = next;
            publish();
        };

        const mutations = new MutationObserver(reconcile);
        mutations.observe(textRoot, { childList: true, subtree: true, attributes: true, attributeFilter: [SCRIPTURE_REFERENCE_MARK] });
        reconcile();

        return () => {
            mutations.disconnect();
            intersections.disconnect();
            links.clear();
        };
    }, [scrollRoot, textRoot, enabled]);

    return visible;
}
