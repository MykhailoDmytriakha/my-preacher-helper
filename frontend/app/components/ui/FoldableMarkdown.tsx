'use client';

import React, { useMemo, useRef } from 'react';

import { useMarkdownOutline, type MarkdownOutlineControl } from '@/hooks/useMarkdownOutline';
import { markdownFoldingPlugin } from '@/utils/markdownFolding';
import { type MarkdownSection } from '@/utils/markdownSections';
import MarkdownDisplay from '@components/MarkdownDisplay';
import { useTranslation } from '@locales/useTranslation';

import { FoldingPresentation, FOLDING_COMPONENTS } from './FoldingPresentation';

interface FoldableMarkdownProps {
    content: string;
    /** Active in-note search. Sections holding a match are force-opened so nothing hides. */
    searchQuery?: string;
    className?: string;
    compact?: boolean;
    /**
     * Share the fold state with something else that draws the same tree (the note
     * page's side panel). Omit it and this component owns the state alone.
     */
    control?: MarkdownOutlineControl;
    /** The note page puts "collapse all" in its side panel instead. */
    showToggleAll?: boolean;
    /**
     * Space kept above a section when something scrolls to it. Without it a jump from
     * the outline parks the heading underneath the sticky header.
     */
    scrollMarginTop?: number;
    /**
     * Something the HOST knows about a section, drawn beside its heading — the sermon
     * screen uses it to say how many scratch atoms were cut from that section.
     *
     * Optional and defaulted off, and nothing is rendered when it returns a falsy value:
     * a wrapper element drawn unconditionally would spend gap and margin on every note
     * page that has no badge to show.
     */
    sectionBadge?: (section: MarkdownSection) => React.ReactNode;
    /**
     * Content the HOST owns, rendered INSIDE an open section, above the section's own text.
     *
     * The sermon screen puts the scratch atoms cut from a section right under its heading:
     * the note and the atoms stop being two blocks competing for the screen and become one
     * stream. Optional and defaulted off — a note page has nothing to put there.
     */
    sectionExtra?: (section: MarkdownSection) => React.ReactNode;
}

/**
 * Renders note markdown as the folding outline its headings already describe: each
 * heading owns the text under it, nested headings sit one step further in behind a
 * guide line, and any heading can be folded away.
 *
 * The stored markdown is never touched — this is presentation only, so every existing
 * note gains the outline without a migration.
 */
export function FoldableMarkdown({
    content,
    searchQuery = '',
    className = '',
    compact = false,
    control,
    showToggleAll = true,
    scrollMarginTop,
    sectionBadge,
    sectionExtra,
}: FoldableMarkdownProps) {
    const { t } = useTranslation();
    // Parsing is skipped when a control is supplied — the owner already did it.
    const ownControl = useMarkdownOutline(control ? '' : content, searchQuery);
    const outlineControl = control ?? ownControl;
    const { outline, sectionIds, toggleAll, everythingCollapsed } =
        outlineControl;

    const root = useRef<HTMLDivElement>(null);
    const plugins = useMemo(() => [markdownFoldingPlugin(outline.sections)], [outline.sections]);
    const presentation = useMemo(() => ({ plugins, components: FOLDING_COMPONENTS }), [plugins]);

    const revealFragment = (event: React.MouseEvent<HTMLDivElement>): void => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-note-reveal-section]') : null;
        if (!anchor || !root.current?.contains(anchor)) return;
        const sectionId = anchor.getAttribute('data-note-reveal-section');
        const href = anchor.getAttribute('href');
        if (!sectionId || !href?.startsWith('#')) return;
        let targetId: string;
        try { targetId = decodeURIComponent(href.slice(1)); } catch { return; }
        const host = event.currentTarget;
        const existing = host.ownerDocument.getElementById(targetId);
        if (existing && host.contains(existing)) return;
        event.preventDefault();
        outlineControl.revealSection(sectionId);
        requestAnimationFrame(() => {
            if (!host.isConnected) return;
            const target = host.ownerDocument.getElementById(targetId);
            if (!(target instanceof HTMLElement) || !host.contains(target)) return;
            host.ownerDocument.defaultView!.location.hash = href;
            target.scrollIntoView?.({ block: 'nearest' });
            const temporaryTabIndex = target.tabIndex < 0 && !target.hasAttribute('tabindex');
            if (temporaryTabIndex) target.tabIndex = -1;
            target.focus({ preventScroll: true });
            if (temporaryTabIndex) target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
        });
    };

    // A heading-free note already has a single whole-document reader.
    if (outline.sections.length === 0) {
        return <MarkdownDisplay content={content} className={className} compact={compact} searchQuery={searchQuery} />;
    }

    return (
        <div className={className} ref={root} onClickCapture={revealFragment}>

            {showToggleAll && sectionIds.length > 1 && (
                <div className="mb-1 flex justify-end">
                    <button
                        type="button"
                        onClick={toggleAll}
                        className="rounded px-2 py-0.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                    >
                        {everythingCollapsed ? t('textOutline.expandAll') : t('textOutline.collapseAll')}
                    </button>
                </div>
            )}

            <FoldingPresentation control={outlineControl} compact={compact} scrollMarginTop={scrollMarginTop} sectionBadge={sectionBadge} sectionExtra={sectionExtra}>
                <MarkdownDisplay content={content} searchQuery={searchQuery} compact={compact} presentation={presentation} />
            </FoldingPresentation>
        </div>
    );
}

export default FoldableMarkdown;
