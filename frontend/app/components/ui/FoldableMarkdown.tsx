'use client';

import { ChevronRightIcon } from '@heroicons/react/24/outline';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useMarkdownOutline, type MarkdownOutlineControl } from '@/hooks/useMarkdownOutline';
import { type MarkdownSection } from '@/utils/markdownSections';
import MarkdownDisplay from '@components/MarkdownDisplay';

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
}

/** Kills the heading's own prose margins so it sits on the toggle row. */
const HEADING_RESET = '[&>*]:!my-0';

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
}: FoldableMarkdownProps) {
    const { t } = useTranslation();
    // Parsing is skipped when a control is supplied — the owner already did it.
    const ownControl = useMarkdownOutline(control ? '' : content, searchQuery);
    const outlineControl = control ?? ownControl;
    const { outline, sectionIds, isCollapsed, toggleSection, toggleAll, everythingCollapsed } =
        outlineControl;

    // No headings at all: nothing to fold, render exactly as before.
    if (outline.sections.length === 0) {
        return <MarkdownDisplay content={content} className={className} compact={compact} searchQuery={searchQuery} />;
    }

    const renderSection = (section: MarkdownSection): React.ReactElement => {
        const collapsed = isCollapsed(section.id);
        const hasContent = Boolean(section.body) || section.children.length > 0;

        return (
            <section key={section.id} data-section-id={section.id} style={{ scrollMarginTop }}>
                <div className="flex items-start gap-1">
                    <button
                        type="button"
                        onClick={() => toggleSection(section.id)}
                        aria-expanded={!collapsed}
                        aria-label={t('textOutline.toggleSection', { title: section.headingText })}
                        className="mt-1 shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                    >
                        <ChevronRightIcon
                            className={`h-4 w-4 transition-transform ${collapsed ? '' : 'rotate-90'}`}
                        />
                    </button>
                    <div
                        onClick={() => toggleSection(section.id)}
                        className="flex min-w-0 flex-1 cursor-pointer items-start gap-2"
                    >
                        <div className={`min-w-0 ${HEADING_RESET}`}>
                            <MarkdownDisplay
                                content={section.headingMarkdown}
                                searchQuery={searchQuery}
                                compact={compact}
                            />
                        </div>
                        {/* Sits right next to the heading, not at the far edge: it tells the
                            reader that text is folded away here, so it has to read as part
                            of this heading. */}
                        {collapsed && hasContent && (
                            <span
                                className="shrink-0 select-none self-center text-sm text-gray-400 dark:text-gray-500"
                                aria-hidden="true"
                            >
                                &hellip;
                            </span>
                        )}
                    </div>
                </div>

                {!collapsed && hasContent && (
                    <div className="ml-2 border-l border-gray-200 pl-4 dark:border-gray-700">
                        {section.body && (
                            <MarkdownDisplay
                                content={section.body}
                                searchQuery={searchQuery}
                                compact={compact}
                            />
                        )}
                        {section.children.map(renderSection)}
                    </div>
                )}
            </section>
        );
    };

    return (
        <div className={className}>
            {outline.intro && (
                <MarkdownDisplay content={outline.intro} searchQuery={searchQuery} compact={compact} />
            )}

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

            {outline.sections.map(renderSection)}
        </div>
    );
}

export default FoldableMarkdown;
