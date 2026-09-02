'use client';

import { useCallback, useMemo, useState } from 'react';

import {
    collectSectionIds,
    findSectionIdsMatching,
    splitMarkdownSections,
    type MarkdownOutline,
} from '@/utils/markdownSections';

/**
 * The fold state of one markdown document, shared by everything that shows it.
 *
 * Why it lives outside the renderer: the note page draws the same heading tree
 * twice — once as the side panel's table of contents, once as the text itself —
 * and folding a section in one has to fold it in the other. Two components each
 * owning a `Set` of collapsed ids would be two copies of the same truth.
 */
export interface MarkdownOutlineControl {
    outline: MarkdownOutline;
    /** Every section id in the tree, outermost first. */
    sectionIds: string[];
    hasSections: boolean;
    everythingCollapsed: boolean;
    isCollapsed: (id: string) => boolean;
    toggleSection: (id: string) => void;
    toggleAll: () => void;
    /** Opens a section and everything above it, so a jump never lands inside folded text. */
    revealSection: (id: string) => void;
}

/**
 * A section holding a search hit is force-opened even while collapsed — otherwise
 * the search silently misses text that is in the note.
 */
export function useMarkdownOutline(content: string, searchQuery = ''): MarkdownOutlineControl {
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());

    const outline = useMemo(() => splitMarkdownSections(content), [content]);
    const sectionIds = useMemo(() => collectSectionIds(outline.sections), [outline.sections]);
    const forcedOpenIds = useMemo(
        () => new Set(findSectionIdsMatching(outline.sections, searchQuery)),
        [outline.sections, searchQuery]
    );

    const isCollapsed = useCallback(
        (id: string) => collapsedIds.has(id) && !forcedOpenIds.has(id),
        [collapsedIds, forcedOpenIds]
    );

    const toggleSection = useCallback((id: string) => {
        setCollapsedIds((previous) => {
            const next = new Set(previous);
            if (!next.delete(id)) next.add(id);
            return next;
        });
    }, []);

    const revealSection = useCallback((id: string) => {
        // Ids are dotted index paths ("0.1.2"), so every ancestor is a prefix of the id.
        const parts = id.split('.');
        const chain = parts.map((_, index) => parts.slice(0, index + 1).join('.'));
        setCollapsedIds((previous) => {
            if (chain.every((ancestor) => !previous.has(ancestor))) return previous;
            const next = new Set(previous);
            chain.forEach((ancestor) => next.delete(ancestor));
            return next;
        });
    }, []);

    const toggleAll = useCallback(() => {
        setCollapsedIds((previous) => {
            const allCollapsed = sectionIds.length > 0 && sectionIds.every((id) => previous.has(id));
            return allCollapsed ? new Set() : new Set(sectionIds);
        });
    }, [sectionIds]);

    const everythingCollapsed =
        sectionIds.length > 0 && sectionIds.every((id) => collapsedIds.has(id));

    return {
        outline,
        sectionIds,
        hasSections: outline.sections.length > 0,
        everythingCollapsed,
        isCollapsed,
        toggleSection,
        toggleAll,
        revealSection,
    };
}
