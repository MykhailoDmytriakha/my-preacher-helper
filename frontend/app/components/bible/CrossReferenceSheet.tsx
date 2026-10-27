'use client';

import { ArrowDownIcon, ArrowUpIcon } from '@heroicons/react/20/solid';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Switch from '@/components/ui/Switch';
import { getBookIds, getLocalizedAbbrev, getLocalizedBookName } from '@/utils/bibleBooks';
import { BIBLES } from '@/utils/bibles';
import { verseWords, type BookText } from '@/utils/bibleText';
import { coversChapter, crossReferenceLabel, crossReferencesAt, isMainReference, type CrossReference, type CrossRefsBook } from '@/utils/crossReferences';

import { ARRIVAL_ATTRIBUTE, ChapterVerses } from './BookRibbon';
import { saveCrossReferencePrefs, useCrossReferencePrefs } from './crossReferencePrefs';
import { ReaderSheet, SheetCloseButton } from './ReaderSheet';
import { useBookTexts } from './useBookTexts';
import { passageAway, restingScrollTop, type PassageBox } from './verseSheetGeometry';

import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';

/** How many verses of a passage the window shows before it says "…". */
const PASSAGE_VERSES_SHOWN = 8;

export type CrossReferencePlace = { chapter: number; verse: number };

type CrossReferenceSheetProps = {
  /** The verse whose links are open; nothing — the window is closed. */
  at: CrossReferencePlace | null;
  bookId: string;
  bible: BibleId;
  locale: AppLocale;
  set: CrossRefsBook | null;
  /** The verse's own text, shown under the title. */
  verseText?: string;
  onClose: () => void;
  /** "Open": the reader goes to the passage. None where the screen under it may not be left — a link is then read in place. */
  onOpenReference?: (reference: CrossReference, from: CrossReferencePlace) => void;
  /** The window's layer: over the reader, or over the passage window, which stands at z-[250]. */
  layerClassName?: string;
  /** The layer of one link's window, opened over this one: a step above `layerClassName`. */
  linkLayerClassName?: string;
};

function passageText(text: BookText | undefined, reference: CrossReference): string | null {
  const verses = text?.chapters[reference.chapter - 1];
  if (!verses) return null;
  const last = Math.min(reference.toVerse, reference.fromVerse + PASSAGE_VERSES_SHOWN - 1);
  const words = verses.slice(reference.fromVerse - 1, last).map(verseWords).join(' ');
  return reference.toVerse > last ? `${words} …` : words;
}

/** Where the lit rows sit in the pane's scrolling text, in px from its top; null — nothing is lit. */
function litBox(pane: HTMLElement): PassageBox | null {
  const rows = Array.from(pane.querySelectorAll<HTMLElement>(`[${ARRIVAL_ATTRIBUTE}="on"]`));
  if (rows.length === 0) return null;
  const origin = pane.getBoundingClientRect().top - pane.scrollTop;
  return {
    top: Math.min(...rows.map((row) => row.getBoundingClientRect().top - origin)),
    bottom: Math.max(...rows.map((row) => row.getBoundingClientRect().bottom - origin)),
  };
}

/**
 * One link in its context — the whole chapter it is in, and only that chapter (the owner, 2026-10-19:
 * "it must be seen that the context is one chapter"): its name above the text, its end below, the
 * passage lit and brought to the middle, "back to the verse" when scrolled away. A link to a whole
 * chapter lights nothing and opens at its start. "Open" goes there to read on; closed, the links are
 * under it as they were.
 */
function ReferenceInContext({ reference, label, text, bible, locale, titleId, onClose, onOpen }: {
  reference: CrossReference; label: string; text: BookText | undefined; bible: BibleId; locale: AppLocale; titleId: string;
  onClose: () => void; onOpen?: () => void;
}) {
  const { t } = useTranslation();
  const verses = text?.chapters[reference.chapter - 1];
  const whole = coversChapter(reference, bible);
  const psalm = reference.book === 'Psalms';
  const paneRef = useRef<HTMLDivElement | null>(null);
  const restedAtRef = useRef<number | null>(null);
  const [away, setAway] = useState<'up' | 'down' | null>(null);

  const rest = useCallback((smooth: boolean) => {
    const pane = paneRef.current;
    if (!pane) return;
    const box = litBox(pane);
    const top = box ? restingScrollTop(box, pane.clientHeight, pane.scrollHeight) : 0;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (smooth && !reduced && typeof pane.scrollTo === 'function') pane.scrollTo({ top, behavior: 'smooth' });
    else pane.scrollTop = top;
    restedAtRef.current = top;
  }, []);

  // The passage comes to the middle once the chapter is in, and again when the serif arrives late and
  // moves every line — unless the person has scrolled.
  useLayoutEffect(() => {
    if (!verses) return undefined;
    rest(false);
    setAway(null);
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive && paneRef.current && paneRef.current.scrollTop === restedAtRef.current) rest(false);
    });
    return () => { alive = false; };
  }, [verses, rest]);

  const noteAway = useCallback(() => {
    const pane = paneRef.current;
    const box = pane ? litBox(pane) : null;
    setAway(pane && box ? passageAway(box, pane.scrollTop, pane.clientHeight) : null);
  }, []);

  // The pane changes height with the screen — a tablet turned, a window made lower: the passage comes
  // back to the middle unless the person has scrolled, and "back to the verse" is asked again if they have.
  useEffect(() => {
    const pane = paneRef.current;
    if (!verses || !pane || typeof ResizeObserver === 'undefined') return undefined;
    let height = pane.clientHeight;
    const observer = new ResizeObserver(() => {
      if (pane.clientHeight === height) return;
      height = pane.clientHeight;
      if (pane.scrollTop === restedAtRef.current) rest(false);
      else noteAway();
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, [verses, rest, noteAway]);

  const heading = psalm
    ? t('bible.psalm', { number: reference.chapter })
    : t('bible.crossRefs.chapterOfBook', { book: getLocalizedBookName(reference.book, locale), number: reference.chapter });
  const scope = whole
    ? t(psalm ? 'bible.crossRefs.scopeLinkPsalm' : 'bible.crossRefs.scopeLinkChapter')
    : t(psalm ? 'bible.crossRefs.scopePsalm' : 'bible.crossRefs.scopeChapter');

  return (
    <>
      <div className="flex shrink-0 items-start justify-between gap-2">
        <h3 id={titleId} className="pt-1 font-serif text-2xl font-bold text-gray-900 dark:text-white">{label}</h3>
        <SheetCloseButton onClose={onClose} />
      </div>
      <div className="mt-1 flex shrink-0 items-baseline justify-between gap-3 border-b border-gray-200 pb-2 dark:border-gray-700">
        <span className="min-w-0 text-sm font-semibold text-gray-900 dark:text-gray-100">{heading}</span>
        <span className="shrink-0 text-xs text-gray-600 dark:text-gray-400">
          {verses ? `${scope} · ${t('bible.crossRefs.verseCount', { count: verses.length })}` : scope}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        {/* The light of the passage reaches 6 px past its verses; the pane reaches as far into the card's
            margin and gives it back as padding, so the text keeps its width and nothing scrolls sideways. */}
        <div
          ref={paneRef}
          onScroll={noteAway}
          tabIndex={0}
          aria-label={heading}
          className="absolute -inset-x-1.5 inset-y-0 overflow-y-auto overflow-x-hidden overscroll-contain px-1.5 pb-20 pt-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
        >
          {verses ? (
            <>
              {/* `isolate`: the light of the passage lies under the text and over the card. */}
              <div className="isolate">
                <ChapterVerses
                  chapter={reference.chapter}
                  verses={verses}
                  lang={BIBLES[bible].language}
                  lit={(verse) => !whole && verse >= reference.fromVerse && verse <= reference.toVerse}
                />
              </div>
              <div className="mt-6 flex items-center gap-3 pl-10">
                <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  {t(psalm ? 'bible.crossRefs.psalmEnd' : 'bible.crossRefs.chapterEnd', { number: reference.chapter })}
                </span>
                <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
              </div>
            </>
          ) : (
            <p role="status" className="py-6 text-center text-sm text-gray-600 dark:text-gray-400">{t('common.loading')}</p>
          )}
        </div>
        {away ? (
          // Where the passage went, the button sits: at the top for a passage scrolled off the top, at the bottom otherwise.
          <button
            type="button"
            onClick={() => rest(true)}
            className={`absolute left-1/2 z-10 inline-flex min-h-11 -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-indigo-600 py-2 pl-3.5 pr-4 text-sm font-semibold text-white shadow-lg transition hover:bg-indigo-700 ${away === 'up' ? 'top-3' : 'bottom-3'}`}
          >
            {away === 'up' ? <ArrowUpIcon className="h-5 w-5" aria-hidden="true" /> : <ArrowDownIcon className="h-5 w-5" aria-hidden="true" />}
            {t('bible.sheet.backToPassage')}
          </button>
        ) : null}
      </div>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="mt-3 min-h-12 w-full shrink-0 rounded-xl bg-indigo-600 px-4 text-base font-semibold text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          {t('bible.crossRefs.open', { place: label })}
        </button>
      ) : null}
    </>
  );
}

/** Links in the order of the Bible: book, chapter, verse. */
function inBibleOrder(references: readonly CrossReference[]): CrossReference[] {
  const order = getBookIds();
  return [...references].sort((a, b) => order.indexOf(a.book) - order.indexOf(b.book) || a.chapter - b.chapter || a.fromVerse - b.fromVerse);
}

/**
 * One link as a verse: its name and its whole text. How many sources give it is not written: the
 * main and the rest already say it (the owner, 2026-10-19, did not read "5 independent sources").
 */
function ReferenceRow({ reference, label, text, onPick }: {
  reference: CrossReference; label: string; text: string | null; onPick: (reference: CrossReference) => void;
}) {
  return (
    <li className="border-b border-gray-100 last:border-b-0 dark:border-gray-800">
      <button type="button" onClick={() => onPick(reference)} className="block w-full py-2.5 text-left">
        <span className="block font-semibold text-indigo-700 dark:text-indigo-300">{label}</span>
        <span className="mt-0.5 block font-serif text-[15px] leading-snug text-gray-700 dark:text-gray-300">{text ?? '…'}</span>
      </button>
    </li>
  );
}

/** The rest of a verse's links, a row per book in the Bible's order, each named by its numbers. */
function OtherReferences({ references, bible, locale, onPick }: {
  references: CrossReference[]; bible: BibleId; locale: AppLocale; onPick: (reference: CrossReference) => void;
}) {
  const groups: { book: string; items: CrossReference[] }[] = [];
  for (const reference of inBibleOrder(references)) {
    const last = groups[groups.length - 1];
    if (last && last.book === reference.book) last.items.push(reference);
    else groups.push({ book: reference.book, items: [reference] });
  }
  /** Within its book's row a link is named by its numbers alone: "12:12", or "46" for a whole chapter. */
  const numbers = (reference: CrossReference) => coversChapter(reference, bible)
    ? String(reference.chapter)
    : `${reference.chapter}:${reference.fromVerse}${reference.toVerse > reference.fromVerse ? `-${reference.toVerse}` : ''}`;
  return (
    <ul>
      {groups.map((group) => (
        <li key={group.book} className="flex items-baseline gap-3 border-t border-gray-100 py-1.5 dark:border-gray-800">
          <span className="w-14 shrink-0 text-xs font-semibold text-gray-600 dark:text-gray-400">{getLocalizedAbbrev(group.book, locale)}</span>
          <span className="flex flex-wrap gap-1">
            {group.items.map((reference) => (
              <button
                key={numbers(reference)}
                type="button"
                onClick={() => onPick(reference)}
                aria-label={crossReferenceLabel(reference, bible, locale)}
                className="min-h-8 rounded-lg bg-gray-100 px-2 text-sm text-indigo-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-indigo-300 dark:hover:bg-gray-700"
              >
                {numbers(reference)}
              </button>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A verse's links: the main ones with their whole text, the rest folded under them — as verses with
 * their text or only as references, the person's choice (`othersAsVerses`, also in Settings → Bible). The
 * switch stands in the rest's row before its chevron while they are open (the owner, 2026-10-16).
 */
function ReferenceList({ references, loading, place, verseText, titleId, bible, locale, texts, othersOpen, onToggleOthers, onPick, onClose }: {
  references: CrossReference[]; loading: boolean; place: string; verseText?: string; titleId: string;
  bible: BibleId; locale: AppLocale; texts: ReadonlyMap<string, BookText>;
  othersOpen: boolean; onToggleOthers: () => void;
  onPick: (reference: CrossReference) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const { othersAsVerses } = useCrossReferencePrefs();
  const main = references.filter(isMainReference);
  const others = references.filter((reference) => !isMainReference(reference));
  const label = (reference: CrossReference) => crossReferenceLabel(reference, bible, locale);
  const textOf = (reference: CrossReference) => passageText(texts.get(reference.book), reference);
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-lg font-bold text-gray-900 dark:text-white">{t('bible.crossRefs.listTitle', { place })}</h3>
        <SheetCloseButton onClose={onClose} />
      </div>
      {verseText ? <p className="mb-2 font-serif text-[15px] leading-snug text-gray-600 dark:text-gray-400">{verseText}</p> : null}
      {loading ? <p className="py-3 text-sm text-gray-600 dark:text-gray-400">{t('common.loading')}</p> : null}
      {main.length > 0 ? (
        <section>
          <h4 className="mt-2 text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-400">{t('bible.crossRefs.mainSection', { number: main.length })}</h4>
          <ul>
            {main.map((reference) => (
              <ReferenceRow key={label(reference)} reference={reference} label={label(reference)} text={textOf(reference)} onPick={onPick} />
            ))}
          </ul>
        </section>
      ) : !loading && references.length > 0 ? (
        <p className="py-2 text-sm text-gray-600 dark:text-gray-400">{t('bible.crossRefs.noMain')}</p>
      ) : null}
      {others.length > 0 ? (
        <section className="mt-1">
          {/*
            The row's own button, the switch and the chevron stand side by side, never one over another:
            a finger a few pixels off a small switch laid over the row folded the rest instead (the
            owner's iPad, 2026-10-16: "it blinks back and forth, then switches on the second time").
          */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-expanded={othersOpen}
              onClick={onToggleOthers}
              className="flex min-h-11 min-w-0 flex-1 items-center text-left text-sm font-semibold text-gray-700 dark:text-gray-200"
            >
              {main.length > 0 ? t('bible.crossRefs.othersSection', { number: others.length }) : t('bible.crossRefs.allSection', { number: others.length })}
            </button>
            {othersOpen ? (
              <Switch
                checked={othersAsVerses}
                label={t('bible.crossRefs.othersAsVerses')}
                onClick={() => saveCrossReferencePrefs({ othersAsVerses: !othersAsVerses }, 'window')}
              />
            ) : null}
            {/* The chevron is the row's button again for a finger; the keyboard has the row's own. */}
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onClick={onToggleOthers}
              className="-mr-2 inline-flex h-11 w-10 shrink-0 items-center justify-center text-gray-700 dark:text-gray-200"
            >
              <ChevronDownIcon className={`h-4 w-4 transition-transform ${othersOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>
          {othersOpen && othersAsVerses ? (
            <ul className="border-t border-gray-100 dark:border-gray-800">
              {inBibleOrder(others).map((reference) => (
                <ReferenceRow key={label(reference)} reference={reference} label={label(reference)} text={textOf(reference)} onPick={onPick} />
              ))}
            </ul>
          ) : othersOpen ? <OtherReferences references={others} bible={bible} locale={locale} onPick={onPick} /> : null}
        </section>
      ) : null}
    </>
  );
}

/**
 * THE LINKS OF ONE VERSE — the list (the main ones with their text, the rest by book or as verses)
 * and one link in its chapter with "Open". Reading stays where it was: the window lies over the page and
 * only "Open" moves the reader. A phone gets it from the bottom edge, a tablet in the middle, a wide
 * screen as a card on the right.
 */
export function CrossReferenceSheet({ at, bookId, bible, locale, set, verseText, onClose, onOpenReference, layerClassName = 'z-[120]', linkLayerClassName = 'z-[130]' }: CrossReferenceSheetProps) {
  const titleId = useId();
  const linkTitleId = useId();
  const [picked, setPicked] = useState<CrossReference | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const { othersAsVerses } = useCrossReferencePrefs();
  const placeKey = at ? `${at.chapter}:${at.verse}` : '';
  useEffect(() => {
    setPicked(null);
    setShowOthers(false);
  }, [placeKey]);

  const references = useMemo(
    () => (at && set ? crossReferencesAt(set, bible, { book: bookId, chapter: at.chapter, verse: at.verse }) : []),
    [at, bible, bookId, set]
  );
  const othersOpen = showOthers || !references.some(isMainReference);
  // The books whose text the window shows: the main links', the rest's while they are open as verses,
  // and the one picked.
  const textBooks = useMemo(
    () => [...new Set(references
      .filter((reference) => isMainReference(reference) || (othersOpen && othersAsVerses))
      .map((reference) => reference.book)
      .concat(picked ? [picked.book] : []))].sort(),
    [references, picked, othersOpen, othersAsVerses]
  );
  const texts = useBookTexts(textBooks, bible);

  if (!at) return null;
  const place = `${getLocalizedAbbrev(bookId, locale)} ${at.chapter}:${at.verse}`;

  return (
    <>
      <ReaderSheet titleId={titleId} onClose={onClose} layerClassName={layerClassName}>
        <ReferenceList
          key={placeKey}
          references={references}
          loading={!set}
          place={place}
          verseText={verseText}
          titleId={titleId}
          bible={bible}
          locale={locale}
          texts={texts}
          othersOpen={othersOpen}
          onToggleOthers={() => setShowOthers((value) => !value)}
          onPick={setPicked}
          onClose={onClose}
        />
      </ReaderSheet>
      {/* One link over the list, as a cascade: closed, the list is found exactly as it was. */}
      {picked ? (
        <ReaderSheet titleId={linkTitleId} onClose={() => setPicked(null)} layerClassName={linkLayerClassName} depth={2} fill>
          <ReferenceInContext
            key={crossReferenceLabel(picked, bible, locale)}
            reference={picked}
            label={crossReferenceLabel(picked, bible, locale)}
            text={texts.get(picked.book)}
            bible={bible}
            locale={locale}
            titleId={linkTitleId}
            onClose={() => setPicked(null)}
            onOpen={onOpenReference ? () => onOpenReference(picked, at) : undefined}
          />
        </ReaderSheet>
      ) : null}
    </>
  );
}
