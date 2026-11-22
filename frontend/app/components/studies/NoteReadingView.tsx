'use client';

import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import { Glasses } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ReaderSheet } from '@/components/bible/ReaderSheet';
import { ScriptureLinks } from '@/components/bible/ScriptureLinks';
import { readTranslation } from '@/components/bible/translation';
import { useBookTexts } from '@/components/bible/useBookTexts';
import FloatingTextScaleControls from '@/components/FloatingTextScaleControls';
import { NoteOutlineTree } from '@/components/studies/NoteOutlineTree';
import { FoldableMarkdown } from '@/components/ui/FoldableMarkdown';
import { useActiveSection } from '@/hooks/useActiveSection';
import { useAppLocale } from '@/hooks/useAppLocale';
import { jumpToSection, type MarkdownOutlineControl } from '@/hooks/useMarkdownOutline';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useModalLayer } from '@/hooks/useModalLayer';
import { useSectionProgress } from '@/hooks/useSectionProgress';
import { useVisibleScriptureReferences } from '@/hooks/useVisibleScriptureReferences';
import { sectionDisplayLabel } from '@/utils/markdownSections';
import { placeShown, versesPreview } from '@/utils/placeText';
import { sameScriptureReference } from '@/utils/scriptureReferenceNumbering';
import { useTranslation } from '@locales/useTranslation';

import type { SheetReference } from '@/components/bible/verseSheetGeometry';
import type { AppLocale } from '@/utils/appLocale';

/** Where the outline sheet's sub-sections count as reached: a little under the column's top. */
const ACTIVE_OFFSET = 96;
/** A jump's own scroll is not the reader's: scrolls this soon after it, and each soon after the last, belong to it. */
const JUMP_SETTLE_MS = 400;
const JUMP_SCROLL_QUIET_MS = 150;
/**
 * The margins hold the outline and the verses on a computer: room for three columns AND a mouse or trackpad as the
 * main pointer. Width alone cannot tell a computer from a tablet — the owner's iPad is 1200 px wide standing up
 * (feedback 2026-11-20, version 427181a) and got the computer's margins. A touch screen wider than a phone gets the
 * tablet's form from the board: the text and a rail of sections. In CSS the same rule is the arbitrary variant
 * `[@media(min-width:1024px)_and_(pointer:fine)]:`; keep the two in step.
 */
const MARGINS_QUERY = '(min-width: 1024px) and (pointer: fine)';
/*
 * On a computer the margins stand at the screen's edges and grow with it (owner, 2026-11-21: «по краям есть место, его можно
 * использовать»): the outline 224–416 px, the places 272–576 px, the text between them up to 900 px — about 85 letters
 * a line, still easy to read — and what is left is shared between the two gaps. Before, the three stood together as
 * one 1356 px block in the middle and a wide screen left empty bands at its sides.
 */
/** A verse beside the text shows its first verses, not a whole chapter. */
const VERSES_SHOWN = 3;
/** Reading speed for «about N minutes of reading»: an unhurried reader of a Bible study. */
const WORDS_PER_MINUTE = 200;
const OUTLINE_KEY = 'notePanel.outline';

export type ReadingPager = { index: number; total: number; onPrevious: (() => void) | null; onNext: (() => void) | null };

type MarginVerse = { key: string; reference: SheetReference; name: string; words: string | null };

/**
 * READING MODE, «the map in the margins» (the owner's choice on the canvas board, 2026-11-20: variant 5, the glasses icon).
 *
 * The same note, drawn over its own page with nothing else around it: one column of text a comfortable line long,
 * and the empty margins put to work — on a computer the outline on the left with how much of each section has been
 * read, and on the right the Scripture places the reader sees on screen now (the owner, 2026-11-20: the places on
 * screen, not the section's), so a reference pressed in the text lights its verse there instead of covering the text. An iPad keeps a rail of sections at the right edge;
 * a phone, a line at the bottom saying which section of how many. Which of the three shows is decided by the
 * screen's width in CSS, so nothing flashes while the page loads.
 *
 * It is a state of the note page, not another page: the text is the page's own renderer (`FoldableMarkdown` with the
 * page's outline, so a section folded here is folded there), Scripture references open the page's own verse window,
 * and the page under it keeps its scroll. Escape, Back and the same glasses button close it (`useModalLayer`).
 */
export function NoteReadingView({
    noteId,
    title,
    typeLabel,
    content,
    searchQuery,
    outline,
    writtenIn,
    startAt,
    pager,
    onOpenReference,
    onClose,
}: {
    noteId: string;
    title: string;
    /** The note's kind (note, question), as its page names it. */
    typeLabel: string;
    content: string;
    searchQuery: string;
    outline: MarkdownOutlineControl;
    /** The language the note is written in, for finding its Scripture references (the page's `readingLanguage`). */
    writtenIn: AppLocale | null;
    /** The section being read on the page when the mode opened: reading goes on from there. */
    startAt: string | null;
    pager: ReadingPager | null;
    onOpenReference: (reference: SheetReference) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const { locale } = useAppLocale();
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
    const versesRef = useRef<HTMLDivElement | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [picked, setPicked] = useState<string | null>(null);
    const [railPill, setRailPill] = useState<string | null>(null);
    const sheetTitleId = useId();
    const layer = useModalLayer({ onClose });

    const sections = outline.outline.sections;
    const sectionIds = useMemo(() => sections.map((section) => section.id), [sections]);
    const activeId = useActiveSection(ACTIVE_OFFSET, true, noteId, scrollRoot);
    const progress = useSectionProgress(scrollRoot, sectionIds, noteId);
    // A jump names the section the reader wants: it stays the current one until the text scrolls again, even when it
    // is too short to reach the reading line. The jump's own scroll — smooth, many frames — does not let it go; a scroll
    // after it settled does, however it was made (wheel, keys, the scrollbar, a finger). A key or a press elsewhere
    // does not: only the text moving changes what is being read.
    const [jumpedTo, setJumpedTo] = useState<string | null>(null);
    const jumpSettlesAt = useRef(0);
    const pin = useCallback((id: string) => {
        jumpSettlesAt.current = Date.now() + JUMP_SETTLE_MS;
        setJumpedTo(id);
    }, []);
    useEffect(() => {
        if (!scrollRoot || !jumpedTo) return undefined;
        const onScroll = () => {
            const now = Date.now();
            if (now < jumpSettlesAt.current) {
                jumpSettlesAt.current = now + JUMP_SCROLL_QUIET_MS;
                return;
            }
            setJumpedTo(null);
        };
        scrollRoot.addEventListener('scroll', onScroll, { passive: true });
        return () => scrollRoot.removeEventListener('scroll', onScroll);
    }, [scrollRoot, jumpedTo]);
    // The section being read, at the top level (the outline beside the text lists those), by the same reading line
    // as the bars under them: the last section the line has reached. One line for both — a bar already filling under
    // a section that is not the lit one read as a fault (the owner, 2026-11-20).
    const readIndex = useMemo(() => {
        let last = 0;
        sectionIds.forEach((id, index) => { if ((progress.bySection[id] ?? 0) > 0) last = index; });
        return last;
    }, [sectionIds, progress]);
    const jumpedIndex = jumpedTo ? sectionIds.indexOf(jumpedTo.split('.')[0]) : -1;
    const currentIndex = jumpedIndex >= 0 ? jumpedIndex : readIndex;
    const current = sections[currentIndex] ?? null;
    // The outline sheet lights sub-sections too: the one jumped to, else the one reached inside the current section,
    // else the section itself.
    const sheetActiveId = jumpedTo
        ?? (activeId && activeId.split('.')[0] === sectionIds[currentIndex] ? activeId : sectionIds[currentIndex] ?? null);
    const untitled = t('textOutline.untitledSection');
    const minutes = Math.max(1, Math.round(content.split(/\s+/).filter(Boolean).length / WORDS_PER_MINUTE));

    // Reading goes on from where it was on the page.
    const started = useRef(false);
    useEffect(() => {
        if (!scrollRoot || started.current) return;
        started.current = true;
        if (!startAt) return;
        const at = scrollRoot.querySelector<HTMLElement>(`[data-section-id="${startAt}"]`)
            ?? scrollRoot.querySelector<HTMLElement>(`[data-section-id="${startAt.split('.')[0]}"]`);
        if (!at) return;
        at.scrollIntoView({ block: 'start' });
        pin(startAt);
    }, [scrollRoot, startAt, pin]);

    // The places' words, in the Bible the verse window opens (`readTranslation`), fetched only where the margin is
    // drawn: a phone has no column to fill.
    const bible = useMemo(() => readTranslation(locale), [locale]);
    const wide = useMediaQuery(MARGINS_QUERY, false);
    const references = useVisibleScriptureReferences(scrollRoot, wide, content);
    const books = useMemo(() => (wide ? [...new Set(references.map((reference) => reference.book))] : []), [wide, references]);
    const texts = useBookTexts(books, bible);
    const verses: MarginVerse[] = useMemo(() => references.map((reference) => {
        const place = placeShown(reference, bible, { text: texts.get(reference.book), locale });
        return { key: JSON.stringify(reference), reference, name: place.name, words: versesPreview(place.verses, VERSES_SHOWN) };
    }), [references, bible, texts, locale]);
    // A lit card goes out with its place: scrolled back to later, it is not lit any more.
    useEffect(() => {
        if (picked && !verses.some((verse) => verse.key === picked)) setPicked(null);
    }, [picked, verses]);

    // A reference pressed in the text: on a computer its verse — on screen, so in the margin — lights up there;
    // elsewhere, or when the margin does not hold it yet, the page's verse window opens as on the page.
    const openLatest = useRef<(reference: SheetReference) => void>(() => undefined);
    openLatest.current = (reference: SheetReference) => {
        const wideNow = typeof window !== 'undefined' && window.matchMedia(MARGINS_QUERY).matches;
        const verse = wideNow ? verses.find((candidate) => sameScriptureReference(candidate.reference, reference)) : undefined;
        if (!verse) {
            onOpenReference(reference);
            return;
        }
        setPicked(verse.key);
        window.requestAnimationFrame(() => {
            versesRef.current?.querySelector(`[data-verse-key="${CSS.escape(verse.key)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
    };
    // One handler for the life of the view, so the text is not drawn again while the reader scrolls.
    const openFromText = useCallback((reference: SheetReference) => openLatest.current(reference), []);
    const text = useMemo(() => (
        <ScriptureLinks onOpen={openFromText} writtenIn={writtenIn}>
            <FoldableMarkdown content={content} searchQuery={searchQuery} control={outline} showToggleAll={false} scrollMarginTop={16} />
        </ScriptureLinks>
    ), [openFromText, writtenIn, content, searchQuery, outline]);

    const jump = useCallback((id: string) => {
        jumpToSection(outline, id, scrollRoot);
        pin(id);
    }, [outline, scrollRoot, pin]);

    const railJump = (id: string) => {
        jump(id);
        setRailPill(id);
    };
    useEffect(() => {
        if (!railPill) return undefined;
        const timer = window.setTimeout(() => setRailPill(null), 1600);
        return () => window.clearTimeout(timer);
    }, [railPill]);

    if (!mounted) return null;

    const currentTitle = current ? sectionDisplayLabel(current, untitled) : title;
    const overallPct = `${Math.round(progress.overall * 100)}%`;
    const position = t('notePanel.positionOf', { current: currentIndex + 1, total: sections.length });

    return createPortal(
        <div
            {...layer}
            role="dialog"
            aria-modal="true"
            aria-label={t('notePanel.readingMode')}
            data-testid="note-reading-view"
            className="fixed inset-0 z-[200] flex flex-col bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-50"
        >
            {/* The one bar: where you are, and the way out. */}
            <div className="relative flex h-[52px] shrink-0 items-center gap-2 border-b border-gray-200 px-2 md:h-14 md:px-4 dark:border-gray-800">
                <span className="h-11 w-11 shrink-0 [@media(min-width:1024px)_and_(pointer:fine)]:h-9 [@media(min-width:1024px)_and_(pointer:fine)]:w-9" aria-hidden />
                <button
                    type="button"
                    onClick={() => setSheetOpen(true)}
                    aria-haspopup="dialog"
                    className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 [@media(min-width:1024px)_and_(pointer:fine)]:hidden"
                >
                    <span className="min-w-0 truncate text-[15px] font-semibold text-emerald-800 dark:text-emerald-300">{currentTitle}</span>
                    <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                </button>
                <span className="hidden min-w-0 flex-1 truncate text-center text-[15px] font-semibold text-emerald-800 [@media(min-width:1024px)_and_(pointer:fine)]:block dark:text-emerald-300">{currentTitle}</span>
                <button
                    type="button"
                    onClick={onClose}
                    title={t('notePanel.exitReadingMode')}
                    aria-label={t('notePanel.exitReadingMode')}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800 transition-colors hover:bg-emerald-200 [@media(min-width:1024px)_and_(pointer:fine)]:h-9 [@media(min-width:1024px)_and_(pointer:fine)]:w-9 dark:bg-emerald-900/40 dark:text-emerald-300"
                >
                    <Glasses className="h-5 w-5" strokeWidth={1.5} aria-hidden />
                </button>
                <span className="absolute bottom-[-1px] left-0 h-0.5 bg-emerald-500 transition-[width] duration-150" style={{ width: overallPct }} aria-hidden />
            </div>

            <div ref={setScrollRoot} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
                <div className="flex justify-center gap-12 px-5 md:pl-10 md:pr-[4.5rem] [@media(min-width:1024px)_and_(pointer:fine)]:justify-between [@media(min-width:1024px)_and_(pointer:fine)]:px-8">
                    {/* Computer: the outline in the left margin, with how much of each section has been read. */}
                    <nav aria-label={t(OUTLINE_KEY)} className="sticky top-6 hidden max-h-[calc(100dvh-7rem)] w-[clamp(14rem,16vw,26rem)] shrink-0 self-start overflow-y-auto pt-2 [@media(min-width:1024px)_and_(pointer:fine)]:block">
                        <div className="px-2.5 pb-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-gray-500 dark:text-gray-400">{t(OUTLINE_KEY)}</div>
                        {sections.map((section, index) => {
                            const isCurrent = index === currentIndex;
                            return (
                                <button
                                    key={section.id}
                                    type="button"
                                    onClick={() => jump(section.id)}
                                    aria-current={isCurrent ? 'location' : undefined}
                                    className="flex w-full flex-col gap-1.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                                >
                                    <span className={`text-sm leading-snug ${isCurrent ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-gray-700 dark:text-gray-300'}`}>{sectionDisplayLabel(section, untitled)}</span>
                                    <span className="block h-0.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700" aria-hidden>
                                        <span className="block h-0.5 bg-emerald-500" style={{ width: `${Math.round((progress.bySection[section.id] ?? 0) * 100)}%` }} />
                                    </span>
                                </button>
                            );
                        })}
                    </nav>

                    {/* The text, the page's own renderer: up to a 900 px line between the computer's margins; with no margins (a tablet, a
                        phone) it takes the whole width up to the rail — the owner on his iPad, 2026-11-20: no empty bands
                        at the sides. */}
                    <article className="w-full min-w-0 pb-40 pt-6 md:pt-10 [@media(min-width:1024px)_and_(pointer:fine)]:max-w-[900px]">
                        <h1 className="text-[25px] font-bold leading-tight tracking-tight text-gray-900 md:text-[34px] dark:text-gray-50">{title || t('studiesWorkspace.untitled')}</h1>
                        <p className="mb-2 mt-2.5 text-sm text-gray-500 dark:text-gray-400">
                            {[typeLabel, sections.length ? t('notePanel.sectionsCount', { count: sections.length }) : null, t('notePanel.readingMinutes', { count: minutes })].filter(Boolean).join(' · ')}
                        </p>
                        <div className="prose prose-emerald max-w-none text-lg prose-headings:text-gray-900 prose-p:leading-relaxed prose-p:text-gray-800 md:text-xl dark:prose-invert dark:prose-headings:text-gray-50 dark:prose-p:text-gray-200 prose-scaled">
                            {text}
                        </div>
                        {pager && pager.total > 1 && (
                            <div className="mt-14 flex items-center justify-between gap-2 border-t border-gray-200 pt-5 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                                <button type="button" onClick={pager.onPrevious ?? undefined} disabled={!pager.onPrevious}
                                    className="min-h-11 rounded-xl border border-gray-200 px-3.5 text-gray-800 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
                                    ‹ {t('common.previous')}
                                </button>
                                <span className="tabular-nums">{t('notePanel.positionOf', { current: pager.index + 1, total: pager.total })}</span>
                                <button type="button" onClick={pager.onNext ?? undefined} disabled={!pager.onNext}
                                    className="min-h-11 rounded-xl border border-gray-200 px-3.5 text-gray-800 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
                                    {t('common.next')} ›
                                </button>
                            </div>
                        )}
                    </article>

                    {/* Computer: the Scripture places on screen now, with their words. */}
                    <aside ref={versesRef} aria-label={t('notePanel.versesOnScreen')} className="sticky top-6 hidden max-h-[calc(100dvh-10rem)] w-[clamp(17rem,20vw,36rem)] shrink-0 flex-col gap-2.5 self-start overflow-y-auto pb-2 pr-1 pt-2 [@media(min-width:1024px)_and_(pointer:fine)]:flex">
                        <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-gray-500 dark:text-gray-400">{t('notePanel.versesOnScreen')}</div>
                        {verses.length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500">{t('notePanel.noVersesOnScreen')}</p>}
                        {verses.map((verse) => (
                            <button
                                key={verse.key}
                                type="button"
                                data-verse-key={verse.key}
                                onClick={() => onOpenReference(verse.reference)}
                                className={`block w-full rounded-xl border px-3.5 py-3 text-left transition-colors ${picked === verse.key
                                    ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/40'
                                    : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700'}`}
                            >
                                <span className="block text-sm font-semibold text-indigo-700 dark:text-indigo-300">{verse.name}</span>
                                <span className="mt-1 block font-serif text-[14.5px] leading-normal text-gray-700 dark:text-gray-300">
                                    {verse.words ?? <span className="font-sans text-xs text-gray-400">{t('notePanel.verseLoading')}</span>}
                                </span>
                            </button>
                        ))}
                        {verses.length > 0 && <p className="text-xs text-gray-400 dark:text-gray-500">{t('notePanel.versesHint')}</p>}
                    </aside>
                </div>
            </div>

            {/* iPad: a rail of sections at the right edge; it scrolls when the sections outnumber its height, and stops
                above the text-size button in the corner, which would cover its last ticks. */}
            {sections.length > 1 && (
                <div className="absolute bottom-20 right-0 top-14 hidden w-14 flex-col gap-0.5 overflow-y-auto border-l [justify-content:safe_center] border-gray-100 bg-white md:flex [@media(min-width:1024px)_and_(pointer:fine)]:hidden dark:border-gray-800 dark:bg-gray-900">
                    {sections.map((section, index) => {
                        const label = sectionDisplayLabel(section, untitled);
                        const read = (progress.bySection[section.id] ?? 0) > 0.95;
                        return (
                            <button key={section.id} type="button" onClick={() => railJump(section.id)} aria-label={label} title={label}
                                className="flex h-11 shrink-0 items-center justify-center">
                                <span className={`block h-1 rounded-full ${index === currentIndex ? 'w-7 bg-emerald-500' : read ? 'w-4 bg-gray-400 dark:bg-gray-500' : 'w-4 bg-gray-300 dark:bg-gray-600'}`} />
                            </button>
                        );
                    })}
                </div>
            )}
            {/* The name of the section tapped on the rail, beside it — outside the scrolling rail, which would clip it. */}
            {railPill && (
                <div className="pointer-events-none absolute right-16 top-1/2 hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white shadow-lg md:block [@media(min-width:1024px)_and_(pointer:fine)]:hidden dark:bg-gray-700">
                    {sectionDisplayLabel(sections.find((section) => section.id === railPill) ?? sections[0], untitled)}
                </div>
            )}

            {/* Phone: which section of how many, and the way into the outline. */}
            {sections.length > 0 && (
                <button
                    type="button"
                    onClick={() => setSheetOpen(true)}
                    aria-haspopup="dialog"
                    aria-label={`${t(OUTLINE_KEY)}: ${position} · ${currentTitle}`}
                    className="relative flex h-14 shrink-0 items-center gap-2.5 border-t border-gray-200 bg-white px-4 text-left md:hidden dark:border-gray-800 dark:bg-gray-900"
                >
                    <span className="absolute left-0 top-[-1px] h-0.5 bg-emerald-500" style={{ width: overallPct }} aria-hidden />
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{position}</span>
                    <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-gray-900 dark:text-gray-100">{currentTitle}</span>
                    <ChevronUpIcon className="h-[18px] w-[18px] shrink-0 text-gray-500" aria-hidden />
                </button>
            )}

            {sheetOpen && (
                <ReaderSheet titleId={sheetTitleId} onClose={() => setSheetOpen(false)} layerClassName="z-[230]">
                    <h2 id={sheetTitleId} className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.06em] text-gray-500 dark:text-gray-400">{t(OUTLINE_KEY)}</h2>
                    <NoteOutlineTree outline={outline} foldable activeSectionId={sheetActiveId} onNavigate={(id) => { pin(id); setSheetOpen(false); }} compact root={scrollRoot} />
                </ReaderSheet>
            )}

            {/* Above the reading layer for the keyboard too: Escape and Back close the size panel first, not the mode. */}
            {!sheetOpen && <FloatingTextScaleControls className="!bottom-20 !z-[220] md:!bottom-6" />}
        </div>,
        document.body,
    );
}

export default NoteReadingView;
