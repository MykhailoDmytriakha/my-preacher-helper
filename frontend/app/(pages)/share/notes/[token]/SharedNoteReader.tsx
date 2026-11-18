'use client';

import { BookmarkIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useState } from 'react';

import { ScriptureText, useScriptureLinks } from '@/components/bible/ScriptureLinks';
import { NoteMobileSheet, type SheetTab } from '@/components/studies/NoteMobileSheet';
import { NoteSidePanel } from '@/components/studies/NoteSidePanel';
import { noteTitleSizeClass } from '@/components/studies/noteTitleSize';
import ScriptureRefBadge from '@/components/studies/ScriptureRefBadge';
import { FoldableMarkdown } from '@/components/ui/FoldableMarkdown';
import { useActiveSection } from '@/hooks/useActiveSection';
import { useMarkdownOutline } from '@/hooks/useMarkdownOutline';
import { useWideViewport } from '@/hooks/useWideViewport';
import { bibleForLocale } from '@/utils/bibles';
import { findSectionById, sectionDisplayLabel } from '@/utils/markdownSections';
import ThemeModeToggle from '@components/navigation/ThemeModeToggle';
import { useTranslation } from '@locales/useTranslation';

import type { ScriptureReference } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';

/** The bar is about 49px tall: a section counts as being read once its heading has passed under it. */
const READING_LINE = 60;

/** The note text as the app's note page draws it in reading mode, larger on a wide screen. */
const TEXT_CLASSES =
    'prose prose-emerald dark:prose-invert prose-headings:text-gray-900 dark:prose-headings:text-gray-50 prose-p:text-gray-800 dark:prose-p:text-gray-200 prose-p:leading-relaxed max-w-none prose-scaled md:[--text-scale:1.125]';

interface SharedNoteReaderProps {
    /** Changes with the link, so the section being read starts over on another note. */
    token: string;
    content: string;
    heading?: string;
    /** The first passages under the title, already worded for the reader. */
    passages?: string;
    hiddenPassages: number;
    scriptureRefs: ScriptureReference[];
    /** The language the note is written in: a passage with no Bible of its own is read in that one. */
    writtenIn: AppLocale;
}

/**
 * A shared note, read the way its owner reads it in the app, without the owner's controls
 * (the owner, 2026-11-18): on a wide screen the note page's side panel holds the outline and
 * the passages; on a phone or an upright iPad the bar says which section is being read and opens
 * the same outline as a sheet. The theme switch sits at the top, where a reader looks for it.
 *
 * Which of the two the screen shows is decided by CSS at the `lg` width, the width the panel and
 * the sheet already switch at, not by a width hook: the page is drawn on the server first, and a
 * hook guessing "wide" there flashed the wrong layout on every phone before the real width arrived.
 */
export function SharedNoteReader({ token, content, heading, passages, hiddenPassages, scriptureRefs, writtenIn }: SharedNoteReaderProps) {
    const { t } = useTranslation();
    const outline = useMarkdownOutline(content);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [sheetTab, setSheetTab] = useState<SheetTab>('outline');
    const [panelHidden, setPanelHidden] = useState(false);
    // CSS hides the sheet on a wide screen, but an open sheet still holds the page's scroll: an
    // upright iPad turned on its side with the outline open would be left unable to scroll.
    const wide = useWideViewport();
    useEffect(() => {
        if (wide) setSheetOpen(false);
    }, [wide]);
    const activeSectionId = useActiveSection(READING_LINE, true, token);
    const activeSection = activeSectionId ? findSectionById(outline.outline.sections, activeSectionId) : null;
    const reading = activeSection ? sectionDisplayLabel(activeSection, t('textOutline.untitledSection')) : null;
    const caption = `${t('shareNotes.title')} · ${t('shareNotes.subtitle')}`;

    const openSheet = (tab: SheetTab) => {
        setSheetTab(tab);
        setSheetOpen(true);
    };

    return (
        <div className="lg:flex lg:items-start">
            <div className="sticky top-0 hidden h-screen shrink-0 lg:block">
                <NoteSidePanel
                    outline={outline}
                    foldable
                    activeSectionId={activeSectionId}
                    collapsed={panelHidden}
                    onToggleCollapsed={() => setPanelHidden((hidden) => !hidden)}
                    meta={caption}
                    scriptureRefs={<SharedPassages refs={scriptureRefs} writtenIn={writtenIn} withHeading />}
                    tags={null}
                />
            </div>
            <div className="min-w-0 flex-1 lg:px-8">
                <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 px-3 pb-1.5 pt-1.5 backdrop-blur-md lg:hidden dark:border-gray-800 dark:bg-gray-900/90">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => openSheet('outline')}
                            aria-haspopup="dialog"
                            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1 text-left transition-colors active:bg-gray-100 dark:active:bg-gray-800"
                        >
                            {reading ? (
                                <span className="min-w-0 truncate text-[15px] font-semibold leading-tight text-emerald-800 dark:text-emerald-300">
                                    {reading}
                                </span>
                            ) : heading ? (
                                <h1 className={`min-w-0 break-words font-bold leading-tight tracking-tight text-gray-900 dark:text-gray-50 ${noteTitleSizeClass(heading)}`}>
                                    {heading}
                                </h1>
                            ) : (
                                <span className="min-w-0 truncate text-[15px] font-semibold leading-tight text-gray-700 dark:text-gray-200">{caption}</span>
                            )}
                            <ChevronDownIcon className={`h-4 w-4 shrink-0 ${reading ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`} />
                        </button>
                        <ThemeModeToggle variant="compact" className="shrink-0" />
                    </div>
                </header>
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-12 pt-5 md:px-8 md:pt-8 lg:max-w-2xl lg:gap-6 lg:px-0 lg:pt-10">
                    <div className="hidden items-start justify-between gap-4 lg:flex">
                        {/* Both titles are an h1: only one of them is ever on screen. */}
                        {heading ? <h1 className="text-3xl font-semibold tracking-tight">{heading}</h1> : <span />}
                        <ThemeModeToggle variant="compact" className="mt-1 shrink-0" />
                    </div>
                    {passages && (
                        <p className="text-sm font-medium text-emerald-700 lg:hidden dark:text-emerald-300">
                            <ScriptureText text={passages} tone="inherit" />
                            {hiddenPassages > 0 && (
                                <>
                                    <span className="font-normal text-gray-500 dark:text-gray-400">{' · '}</span>
                                    <button
                                        type="button"
                                        onClick={() => openSheet('properties')}
                                        className="font-normal text-gray-600 underline decoration-gray-300 underline-offset-4 dark:text-gray-300 dark:decoration-gray-600"
                                    >
                                        {t('shareNotes.morePassages', { count: hiddenPassages })}
                                    </button>
                                </>
                            )}
                        </p>
                    )}
                    <div className={TEXT_CLASSES}>
                        <FoldableMarkdown content={content} control={outline} showToggleAll={false} scrollMarginTop={READING_LINE} />
                    </div>
                    <footer className="mt-10 border-t border-gray-200 pt-5 text-sm text-gray-500 lg:hidden dark:border-gray-800 dark:text-gray-400">{caption}</footer>
                </div>
            </div>
            <NoteMobileSheet
                open={sheetOpen}
                onClose={() => setSheetOpen(false)}
                outline={outline}
                foldable
                activeSectionId={activeSectionId}
                scriptureRefs={<SharedPassages refs={scriptureRefs} writtenIn={writtenIn} />}
                tags={null}
                openOn={sheetTab}
                propertiesLabel={
                    <>
                        {t('studiesWorkspace.scriptureRefs')}{' '}
                        <span className="font-normal text-gray-500 dark:text-gray-400">{scriptureRefs.length}</span>
                    </>
                }
            />
        </div>
    );
}

/** Every passage of the note, each opening its verses in the window the text's links open. */
function SharedPassages({ refs, writtenIn, withHeading = false }: { refs: ScriptureReference[]; writtenIn: AppLocale; withHeading?: boolean }) {
    const { t } = useTranslation();
    const links = useScriptureLinks();
    const fallbackBible = useMemo(() => bibleForLocale(writtenIn), [writtenIn]);
    if (refs.length === 0) return null;
    return (
        <div className="flex flex-col gap-3">
            {withHeading && (
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500">
                    <BookmarkIcon className="h-5 w-5" />
                    <span className="text-sm font-medium">{t('studiesWorkspace.scriptureRefs')}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{refs.length}</span>
                </div>
            )}
            <div className="flex flex-wrap gap-2">
                {refs.map((reference) => (
                    <ScriptureRefBadge
                        key={reference.id}
                        reference={reference}
                        onClick={() => links?.onOpen({ ...reference, bible: reference.bible ?? fallbackBible })}
                    />
                ))}
            </div>
        </div>
    );
}

export default SharedNoteReader;
