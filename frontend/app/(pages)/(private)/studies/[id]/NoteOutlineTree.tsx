'use client';

import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { type MarkdownOutlineControl } from '@/hooks/useMarkdownOutline';
import { type MarkdownSection } from '@/utils/markdownSections';

/**
 * The note's table of contents, drawn once for every surface that shows it.
 *
 * There are two of those — the side panel on a wide screen and the bottom sheet on a
 * phone — and they must fold, jump and highlight identically: a second implementation
 * of the same tree would drift, and the drift would read as a bug in whichever surface
 * was looked at second.
 */
export function NoteOutlineTree({
    outline,
    foldable,
    activeSectionId,
    onNavigate,
    compact = false,
}: {
    outline: MarkdownOutlineControl;
    /**
     * False while editing: the text is a Tiptap editor there, not the folding renderer,
     * so a fold arrow would be a control that does nothing.
     */
    foldable: boolean;
    activeSectionId?: string | null;
    /** Called after a jump — the sheet uses it to close itself. */
    onNavigate?: () => void;
    /** Touch sizing: taller rows and larger text, for the sheet on a phone. */
    compact?: boolean;
}) {
    return (
        <div className={`flex flex-col ${compact ? 'gap-px' : 'gap-px'}`}>
            {outline.outline.sections.map((section) => (
                <OutlineRow
                    key={section.id}
                    section={section}
                    outline={outline}
                    depth={0}
                    foldable={foldable}
                    activeSectionId={activeSectionId}
                    onNavigate={onNavigate}
                    touch={compact}
                />
            ))}
        </div>
    );
}

/**
 * Brings a heading into view. The section is opened first (with its ancestors) so the
 * jump never lands inside folded text.
 */
export function jumpToSection(outline: MarkdownOutlineControl, id: string) {
    outline.revealSection(id);
    // After the reveal has rendered, or the target may still be unmounted.
    requestAnimationFrame(() => {
        document
            .querySelector(`[data-section-id="${id}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

function OutlineRow({
    section,
    outline,
    depth,
    foldable,
    activeSectionId,
    onNavigate,
    touch,
}: {
    section: MarkdownSection;
    outline: MarkdownOutlineControl;
    depth: number;
    foldable: boolean;
    activeSectionId?: string | null;
    onNavigate?: () => void;
    touch: boolean;
}) {
    const { t } = useTranslation();
    const collapsed = foldable && outline.isCollapsed(section.id);
    const canFold = foldable && (section.children.length > 0 || Boolean(section.body));
    const isActive = activeSectionId === section.id;

    return (
        <>
            <div
                className={`flex items-start gap-1.5 rounded-md pr-1 transition-colors ${touch ? 'py-2' : 'py-1'} ${isActive ? 'bg-emerald-50 dark:bg-emerald-900/25' : 'hover:bg-gray-200/60 dark:hover:bg-gray-800'}`}
                style={{ paddingLeft: `${4 + depth * 12}px` }}
            >
                {canFold ? (
                    <button
                        type="button"
                        onClick={() => outline.toggleSection(section.id)}
                        aria-expanded={!collapsed}
                        aria-label={t('textOutline.toggleSection', { title: section.headingText })}
                        className={`shrink-0 rounded text-gray-400 transition-colors hover:bg-gray-300/60 hover:text-gray-800 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200 ${touch ? 'mt-px p-1.5' : 'mt-0.5 p-0.5'}`}
                    >
                        {collapsed ? (
                            <ChevronRightIcon className="h-3.5 w-3.5" />
                        ) : (
                            <ChevronDownIcon className="h-3.5 w-3.5" />
                        )}
                    </button>
                ) : (
                    <span className={touch ? 'w-[27px] shrink-0' : 'w-[19px] shrink-0'} />
                )}
                {/* The whole label is the jump target — a heading in a narrow column has to
                    wrap, so truncating it would hide exactly what you are aiming at. */}
                <button
                    type="button"
                    onClick={() => {
                        jumpToSection(outline, section.id);
                        onNavigate?.();
                    }}
                    title={section.headingText}
                    className={`min-w-0 flex-1 break-words text-left transition-colors hover:text-emerald-700 dark:hover:text-emerald-300 ${touch ? 'py-0.5 text-[15px] leading-[22px]' : 'text-[13px] leading-5'} ${isActive ? 'text-emerald-800 dark:text-emerald-200' : depth === 0 ? 'text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'} ${depth === 0 ? 'font-bold' : ''}`}
                >
                    {section.headingText}
                </button>
                {collapsed && section.children.length > 0 && (
                    <span className="mt-0.5 shrink-0 text-[11px] text-gray-400 dark:text-gray-600">
                        {section.children.length}
                    </span>
                )}
            </div>
            {!collapsed &&
                section.children.map((child) => (
                    <OutlineRow
                        key={child.id}
                        section={child}
                        outline={outline}
                        depth={depth + 1}
                        foldable={foldable}
                        activeSectionId={activeSectionId}
                        onNavigate={onNavigate}
                        touch={touch}
                    />
                ))}
        </>
    );
}

export default NoteOutlineTree;
