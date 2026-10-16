'use client';

import { ArrowLeftIcon, ChevronDownIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useModalLayer } from '@/hooks/useModalLayer';
import { getBookIds, getLocalizedAbbrev } from '@/utils/bibleBooks';
import { fetchBookText, verseWords, type BookText } from '@/utils/bibleText';
import { coversChapter, crossReferenceLabel, crossReferencesAt, isMainReference, type CrossReference, type CrossRefsBook } from '@/utils/crossReferences';

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
  /** "Open": the reader goes to the passage. */
  onOpenReference: (reference: CrossReference, from: CrossReferencePlace) => void;
  /** The window's layer: over the reader, or over the passage window, which stands at z-[250]. */
  layerClassName?: string;
};

/** The texts of the books the links point into, fetched as they are needed (kept on the device by the worker). */
function useBookTexts(books: readonly string[], bible: BibleId): ReadonlyMap<string, BookText> {
  const [texts, setTexts] = useState<ReadonlyMap<string, BookText>>(new Map());
  const wanted = books.join('|');
  useEffect(() => {
    let alive = true;
    for (const book of new Set(wanted ? wanted.split('|') : [])) {
      if (texts.has(book)) continue;
      fetchBookText(book, bible).then(
        (text) => { if (alive) setTexts((known) => new Map(known).set(book, text)); },
        () => undefined,
      );
    }
    return () => { alive = false; };
    // `texts` is read to skip books already here; refetching on its change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bible, wanted]);
  return texts;
}

function passageText(text: BookText | undefined, reference: CrossReference): string | null {
  const verses = text?.chapters[reference.chapter - 1];
  if (!verses) return null;
  const last = Math.min(reference.toVerse, reference.fromVerse + PASSAGE_VERSES_SHOWN - 1);
  const words = verses.slice(reference.fromVerse - 1, last).map(verseWords).join(' ');
  return reference.toVerse > last ? `${words} …` : words;
}

function CloseButton({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" onClick={onClose} aria-label={t('common.close')} className="-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
      <XMarkIcon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

/** One link: its text, how many independent sources give it, and "Open". */
function ReferenceDetail({ reference, label, text, place, titleId, onBack, onClose, onOpen }: {
  reference: CrossReference; label: string; text: string | null; place: string; titleId: string;
  onBack: () => void; onClose: () => void; onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onBack} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800">
          <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />
          {t('bible.crossRefs.backToList', { place })}
        </button>
        <CloseButton onClose={onClose} />
      </div>
      <h3 id={titleId} className="font-serif text-2xl font-bold text-gray-900 dark:text-white">{label}</h3>
      <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{t('bible.crossRefs.sources', { count: reference.weight })}</p>
      <p className="mt-3 font-serif text-lg leading-relaxed text-gray-800 dark:text-gray-100">{text ?? t('common.loading')}</p>
      <button
        type="button"
        onClick={onOpen}
        className="mt-4 min-h-12 w-full rounded-xl bg-indigo-600 px-4 text-base font-semibold text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
      >
        {t('bible.crossRefs.open', { place: label })}
      </button>
    </>
  );
}

/** The rest of a verse's links, a row per book in the Bible's order, each named by its numbers. */
function OtherReferences({ references, bible, locale, onPick }: {
  references: CrossReference[]; bible: BibleId; locale: AppLocale; onPick: (reference: CrossReference) => void;
}) {
  const order = getBookIds();
  const groups: { book: string; items: CrossReference[] }[] = [];
  for (const reference of [...references].sort((a, b) => order.indexOf(a.book) - order.indexOf(b.book) || a.chapter - b.chapter || a.fromVerse - b.fromVerse)) {
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

/** A verse's links: the main ones with the start of their text, the rest folded under them. */
function ReferenceList({ references, loading, place, verseText, titleId, bible, locale, texts, onPick, onClose }: {
  references: CrossReference[]; loading: boolean; place: string; verseText?: string; titleId: string;
  bible: BibleId; locale: AppLocale; texts: ReadonlyMap<string, BookText>;
  onPick: (reference: CrossReference) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [showOthers, setShowOthers] = useState(false);
  const main = references.filter(isMainReference);
  const others = references.filter((reference) => !isMainReference(reference));
  const othersOpen = showOthers || main.length === 0;
  const label = (reference: CrossReference) => crossReferenceLabel(reference, bible, locale);
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-lg font-bold text-gray-900 dark:text-white">{t('bible.crossRefs.listTitle', { place })}</h3>
        <CloseButton onClose={onClose} />
      </div>
      {verseText ? <p className="mb-2 font-serif text-[15px] leading-snug text-gray-600 dark:text-gray-400">{verseText}</p> : null}
      {loading ? <p className="py-3 text-sm text-gray-600 dark:text-gray-400">{t('common.loading')}</p> : null}
      {main.length > 0 ? (
        <section>
          <h4 className="mt-2 text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-400">{t('bible.crossRefs.mainSection', { number: main.length })}</h4>
          <ul>
            {main.map((reference) => (
              <li key={label(reference)} className="border-b border-gray-100 last:border-b-0 dark:border-gray-800">
                <button type="button" onClick={() => onPick(reference)} className="block w-full py-2.5 text-left">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-indigo-700 dark:text-indigo-300">{label(reference)}</span>
                    <span className="shrink-0 text-xs text-gray-600 dark:text-gray-400">{t('bible.crossRefs.sources', { count: reference.weight })}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 font-serif text-[15px] leading-snug text-gray-700 dark:text-gray-300">
                    {passageText(texts.get(reference.book), reference) ?? '…'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : !loading && references.length > 0 ? (
        <p className="py-2 text-sm text-gray-600 dark:text-gray-400">{t('bible.crossRefs.noMain')}</p>
      ) : null}
      {others.length > 0 ? (
        <section className="mt-1">
          <button
            type="button"
            aria-expanded={othersOpen}
            onClick={() => setShowOthers((value) => !value)}
            className="flex min-h-11 w-full items-center justify-between text-sm font-semibold text-gray-700 dark:text-gray-200"
          >
            {main.length > 0 ? t('bible.crossRefs.othersSection', { number: others.length }) : t('bible.crossRefs.allSection', { number: others.length })}
            <ChevronDownIcon className={`h-4 w-4 transition-transform ${othersOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {othersOpen ? <OtherReferences references={others} bible={bible} locale={locale} onPick={onPick} /> : null}
        </section>
      ) : null}
    </>
  );
}

/**
 * THE LINKS OF ONE VERSE — the list (the main ones with the start of their text, the rest by book)
 * and one link's text with "Open". Reading stays where it was: the window lies over the page and
 * only "Open" moves the reader. A phone gets it from the bottom edge, a tablet in the middle, a wide
 * screen as a card on the right.
 */
export function CrossReferenceSheet({ at, bookId, bible, locale, set, verseText, onClose, onOpenReference, layerClassName = 'z-[120]' }: CrossReferenceSheetProps) {
  const titleId = useId();
  const [picked, setPicked] = useState<CrossReference | null>(null);
  const layer = useModalLayer({ onClose, active: Boolean(at) });
  // The keyboard goes into the window and stays there — over a passage window too, whose own trap
  // yields to the window above it — and goes back to the chip or number that opened it.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const isOpen = Boolean(at);
  useFocusTrap(dialogRef, isOpen);
  useEffect(() => {
    if (!isOpen) return undefined;
    const before = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [isOpen]);

  const placeKey = at ? `${at.chapter}:${at.verse}` : '';
  useEffect(() => setPicked(null), [placeKey]);

  const references = useMemo(
    () => (at && set ? crossReferencesAt(set, bible, { book: bookId, chapter: at.chapter, verse: at.verse }) : []),
    [at, bible, bookId, set]
  );
  const textBooks = useMemo(
    () => [...new Set([...references.filter(isMainReference).map((reference) => reference.book), ...(picked ? [picked.book] : [])])].sort(),
    [references, picked]
  );
  const texts = useBookTexts(textBooks, bible);

  if (!at || typeof document === 'undefined') return null;
  const place = `${getLocalizedAbbrev(bookId, locale)} ${at.chapter}:${at.verse}`;

  return createPortal(
    <div {...layer} className={`fixed inset-0 ${layerClassName} flex items-end justify-center xl:items-start xl:justify-end`}>
      <button type="button" aria-hidden="true" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-black/30" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-white px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2 shadow-2xl dark:bg-gray-900 md:max-w-xl xl:mr-6 xl:mt-24 xl:max-h-[calc(100dvh-8rem)] xl:w-[24rem] xl:rounded-3xl xl:pb-5 xl:pt-4"
      >
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-gray-300 xl:hidden dark:bg-gray-600" />
        {picked ? (
          <ReferenceDetail
            reference={picked}
            label={crossReferenceLabel(picked, bible, locale)}
            text={passageText(texts.get(picked.book), picked)}
            place={place}
            titleId={titleId}
            onBack={() => setPicked(null)}
            onClose={onClose}
            onOpen={() => onOpenReference(picked, at)}
          />
        ) : (
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
            onPick={setPicked}
            onClose={onClose}
          />
        )}
      </div>
    </div>,
    document.body
  );
}
