'use client';

import { XMarkIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type MarkdownOutlineControl } from '@/hooks/useMarkdownOutline';

import { NoteOutlineTree } from './NoteOutlineTree';

interface NoteMobileSheetProps {
    open: boolean;
    onClose: () => void;
    /** Shared with the note text, so folding here folds there. */
    outline: MarkdownOutlineControl;
    /** False while editing — the editor is not the folding renderer. */
    foldable: boolean;
    activeSectionId?: string | null;
    /** "Created 10 March 2026" — metadata, so it lives with the metadata. */
    meta?: React.ReactNode;
    scriptureRefs: React.ReactNode;
    tags: React.ReactNode;
    sermons?: React.ReactNode;
}

type SheetTab = 'outline' | 'properties';

/**
 * Everything about the note that is not its text, on a phone: its table of contents,
 * scripture references, tags, the sermons built on it and its dates.
 *
 * The wide screen keeps all of this in a side panel that is always there. A phone has no
 * width to give away, so the same content comes up from the bottom when asked for and
 * leaves again — the note's text never gives up a pixel to it. It is the same outline
 * tree the panel draws, not a second one.
 */
export function NoteMobileSheet({
    open,
    onClose,
    outline,
    foldable,
    activeSectionId,
    meta,
    scriptureRefs,
    tags,
    sermons,
}: NoteMobileSheetProps) {
    const { t } = useTranslation();
    const [tab, setTab] = useState<SheetTab>('outline');

    // A note with no headings has no table of contents to open on.
    useEffect(() => {
        if (!outline.hasSections) setTab('properties');
    }, [outline.hasSections]);

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    return (
        <div className="lg:hidden" aria-hidden={!open}>
            <button
                type="button"
                tabIndex={open ? 0 : -1}
                aria-label={t('common.close')}
                onClick={onClose}
                className={`fixed inset-0 z-40 bg-gray-900/40 transition-opacity duration-200 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            />
            <div
                role="dialog"
                aria-modal={open}
                aria-label={t('notePanel.outline')}
                className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[76vh] flex-col rounded-t-2xl border-t border-gray-200 bg-white shadow-[0_-8px_30px_rgba(15,23,42,0.18)] transition-transform duration-200 ease-out dark:border-gray-700 dark:bg-gray-900 ${open ? 'translate-y-0' : 'pointer-events-none translate-y-full'}`}
            >
                <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600" />

                <div className="flex shrink-0 items-center gap-1 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
                    {outline.hasSections && (
                        <SheetTabButton active={tab === 'outline'} onClick={() => setTab('outline')}>
                            {t('notePanel.outline')}
                        </SheetTabButton>
                    )}
                    <SheetTabButton active={tab === 'properties'} onClick={() => setTab('properties')}>
                        {t('notePanel.properties')}
                    </SheetTabButton>
                    <div className="ml-auto flex items-center gap-1">
                        {tab === 'outline' && foldable && outline.sectionIds.length > 1 && (
                            <button
                                type="button"
                                onClick={outline.toggleAll}
                                className="rounded-lg px-2 py-1.5 text-xs text-emerald-600 dark:text-emerald-400"
                            >
                                {outline.everythingCollapsed
                                    ? t('textOutline.expandAll')
                                    : t('textOutline.collapseAll')}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label={t('common.close')}
                            tabIndex={open ? 0 : -1}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                        >
                            <XMarkIcon className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
                    {tab === 'outline' ? (
                        outline.hasSections ? (
                            <NoteOutlineTree
                                outline={outline}
                                foldable={foldable}
                                activeSectionId={activeSectionId}
                                onNavigate={onClose}
                                compact
                            />
                        ) : (
                            <p className="px-3 py-4 text-sm text-gray-400 dark:text-gray-500">
                                {t('notePanel.outlineEmpty')}
                            </p>
                        )
                    ) : (
                        <div className="flex flex-col gap-5 px-3 pb-2 pt-1">
                            {meta && (
                                <div className="text-xs leading-[17px] text-gray-400 dark:text-gray-500">
                                    {meta}
                                </div>
                            )}
                            {scriptureRefs}
                            <div className="border-t border-gray-100 pt-4 dark:border-gray-800">{tags}</div>
                            {/* `empty:hidden`: no sermon names this note — a divider around
                                emptiness reads as a bug. */}
                            <div className="border-t border-gray-100 pt-4 empty:hidden dark:border-gray-800">
                                {sermons}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function SheetTabButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${active ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200' : 'text-gray-400 dark:text-gray-500'}`}
        >
            {children}
        </button>
    );
}

export default NoteMobileSheet;
