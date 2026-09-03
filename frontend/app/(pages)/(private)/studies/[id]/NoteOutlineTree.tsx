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

/**
 * What stands at the head of an outline row: an arrow when there are headings to hide
 * under it, a bullet when the row is a leaf, and bare space for a parent while the note
 * is being edited — there nothing folds, but the row is not a leaf either.
 */
function RowMarker({
    canFold,
    hasChildren,
    collapsed,
    touch,
    label,
    onToggle,
}: {
    canFold: boolean;
    hasChildren: boolean;
    collapsed: boolean;
    touch: boolean;
    label: string;
    onToggle: () => void;
}) {
    if (canFold) {
        return (
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={!collapsed}
                aria-label={label}
                className={`shrink-0 rounded text-gray-400 transition-colors hover:bg-gray-300/60 hover:text-gray-800 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200 ${touch ? 'mt-px p-1.5' : 'mt-0.5 p-0.5'}`}
            >
                {collapsed ? (
                    <ChevronRightIcon className="h-3.5 w-3.5" />
                ) : (
                    <ChevronDownIcon className="h-3.5 w-3.5" />
                )}
            </button>
        );
    }

    if (hasChildren) {
        return <span className={touch ? 'w-[27px] shrink-0' : 'w-[19px] shrink-0'} />;
    }

    return (
        <span
            data-testid="outline-leaf-marker"
            aria-hidden
            className={`flex shrink-0 items-center justify-center ${touch ? 'mt-px h-[26px] w-[27px]' : 'mt-0.5 h-[18px] w-[19px]'}`}
        >
            <span
                className={`rounded-full bg-gray-400 dark:bg-gray-500 ${touch ? 'h-1.5 w-1.5' : 'h-1 w-1'}`}
            />
        </span>
    );
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
    // A tree of headings can only hide headings. Body text under a leaf is folded from
    // the document itself, where that text is visible — offering it here drew an arrow
    // that changed nothing on the surface it was drawn on.
    const hasChildren = section.children.length > 0;
    const canFold = foldable && hasChildren;
    const isActive = activeSectionId === section.id;

    return (
        <>
            <div
                className={`flex items-start gap-1.5 rounded-md pr-1 transition-colors ${touch ? 'py-2' : 'py-1'} ${isActive ? 'bg-emerald-50 dark:bg-emerald-900/25' : 'hover:bg-gray-200/60 dark:hover:bg-gray-800'}`}
                style={{ paddingLeft: `${4 + depth * 12}px` }}
            >
                <RowMarker
                    canFold={canFold}
                    hasChildren={hasChildren}
                    collapsed={collapsed}
                    touch={touch}
                    label={t('textOutline.toggleSection', { title: section.headingText })}
                    onToggle={() => outline.toggleSection(section.id)}
                />
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
