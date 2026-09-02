'use client';

import {
    BookmarkIcon,
    ChevronDoubleLeftIcon,
    ChevronDoubleRightIcon,
    DocumentTextIcon,
    ListBulletIcon,
    TagIcon,
} from '@heroicons/react/24/outline';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { type MarkdownOutlineControl } from '@/hooks/useMarkdownOutline';

import { NoteOutlineTree } from './NoteOutlineTree';

interface NoteSidePanelProps {
    /** Shared with the note text, so folding here folds there. */
    outline: MarkdownOutlineControl;
    /**
     * False while editing: the text is a Tiptap editor there, not the folding renderer,
     * so a fold arrow would be a control that does nothing. The outline stays as a map
     * of the note.
     */
    foldable: boolean;
    /** Distance from the top of the window the panel sticks at, in px. */
    stickyTop: number;
    /** The section currently being read, highlighted so the map says where you are. */
    activeSectionId?: string | null;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    /** Drives the dot on the rail's sermon icon — shown only when there really is one. */
    hasSermons?: boolean;
    /** "Created 10 March 2026" — metadata, so it lives with the metadata. */
    meta?: React.ReactNode;
    scriptureRefs: React.ReactNode;
    tags: React.ReactNode;
    sermons?: React.ReactNode;
}

const RAIL_BUTTON =
    'flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-200/70 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800';

const SECTION_LABEL =
    'text-[11px] font-bold uppercase tracking-[0.06em] text-gray-400 dark:text-gray-500';

/**
 * Everything about the note that is not the note's text: its table of contents,
 * scripture references, tags and the sermons built on it. Previously these sat in a
 * tray under the text and had to be scrolled to.
 *
 * It sticks and scrolls on its own: the outline is a map you consult WHILE reading, so
 * it must not travel away with the text it describes.
 */
export function NoteSidePanel({
    outline,
    foldable,
    stickyTop,
    activeSectionId,
    collapsed,
    onToggleCollapsed,
    hasSermons = false,
    meta,
    scriptureRefs,
    tags,
    sermons,
}: NoteSidePanelProps) {
    const { t } = useTranslation();

    if (collapsed) {
        return (
            <aside
                className="sticky hidden w-[52px] shrink-0 flex-col items-center gap-1 self-start border-r border-gray-200 bg-gray-50 py-3 lg:flex dark:border-gray-800 dark:bg-gray-900/40"
                style={{ top: stickyTop, height: `calc(100vh - ${stickyTop}px)` }}
            >
                <button
                    type="button"
                    onClick={onToggleCollapsed}
                    title={t('notePanel.show')}
                    aria-label={t('notePanel.show')}
                    aria-expanded={false}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                    <ChevronDoubleRightIcon className="h-4 w-4" />
                </button>
                <div className="my-2 h-px w-6 bg-gray-200 dark:bg-gray-700" />
                {/* Says what is behind the rail, so a hidden panel still advertises what it
                    holds — and each icon is the way back in. */}
                <button type="button" onClick={onToggleCollapsed} title={t('notePanel.outline')} aria-label={t('notePanel.outline')} className={RAIL_BUTTON}>
                    <ListBulletIcon className="h-[17px] w-[17px]" />
                </button>
                <button type="button" onClick={onToggleCollapsed} title={t('studiesWorkspace.scriptureRefs')} aria-label={t('studiesWorkspace.scriptureRefs')} className={RAIL_BUTTON}>
                    <BookmarkIcon className="h-[17px] w-[17px]" />
                </button>
                <button type="button" onClick={onToggleCollapsed} title={t('studiesWorkspace.tags')} aria-label={t('studiesWorkspace.tags')} className={RAIL_BUTTON}>
                    <TagIcon className="h-[17px] w-[17px]" />
                </button>
                <button type="button" onClick={onToggleCollapsed} title={t('notePanel.sermons')} aria-label={t('notePanel.sermons')} className={`relative ${RAIL_BUTTON}`}>
                    <DocumentTextIcon className="h-[17px] w-[17px]" />
                    {hasSermons && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-blue-500" />}
                </button>
            </aside>
        );
    }

    return (
        <aside
            className="sticky hidden w-[272px] shrink-0 flex-col gap-4 self-start overflow-y-auto border-r border-gray-200 bg-gray-50 px-3.5 py-4 lg:flex dark:border-gray-800 dark:bg-gray-900/40"
            style={{ top: stickyTop, height: `calc(100vh - ${stickyTop}px)` }}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 text-xs leading-[17px] text-gray-400 dark:text-gray-500">{meta}</div>
                <button
                    type="button"
                    onClick={onToggleCollapsed}
                    title={t('notePanel.hide')}
                    aria-label={t('notePanel.hide')}
                    aria-expanded
                    className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                    <ChevronDoubleLeftIcon className="h-3.5 w-3.5" />
                </button>
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                    <span className={SECTION_LABEL}>{t('notePanel.outline')}</span>
                    {foldable && outline.sectionIds.length > 1 && (
                        <button
                            type="button"
                            onClick={outline.toggleAll}
                            className="rounded px-1 text-[11px] text-emerald-600 transition-colors hover:text-emerald-700 dark:text-emerald-400"
                        >
                            {outline.everythingCollapsed
                                ? t('textOutline.expandAll')
                                : t('textOutline.collapseAll')}
                        </button>
                    )}
                </div>

                {outline.hasSections ? (
                    <NoteOutlineTree
                        outline={outline}
                        foldable={foldable}
                        activeSectionId={activeSectionId}
                    />
                ) : (
                    <p className="px-2 text-xs leading-4 text-gray-400 dark:text-gray-500">
                        {t('notePanel.outlineEmpty')}
                    </p>
                )}
            </div>

            <div className="flex flex-col gap-2 border-t border-gray-200 pt-3.5 dark:border-gray-800">
                {scriptureRefs}
            </div>

            <div className="flex flex-col gap-2 border-t border-gray-200 pt-3.5 dark:border-gray-800">
                {tags}
            </div>

            {/* `empty:hidden`: SermonsBuiltOnNote renders nothing when no sermon names this
                note, and a divider around emptiness reads as a bug. */}
            <div className="flex flex-col gap-2 border-t border-gray-200 pt-3.5 empty:hidden dark:border-gray-800">
                {sermons}
            </div>
        </aside>
    );
}

export default NoteSidePanel;
