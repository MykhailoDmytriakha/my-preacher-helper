'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BibleBookList } from '@/components/bible/BibleBookList';
import { BibleBookReader } from '@/components/bible/BibleBookReader';
import { newEntryState, parsePlaceParam, readLastPlace, type LastPlace } from '@/components/bible/lastPlace';
import { readTranslation, saveTranslation } from '@/components/bible/translation';
import { resolveAppLocale } from '@/utils/appLocale';
import { parsePassageEnd, wayBackPath } from '@/utils/bibleLink';
import { isBibleId, type BibleId } from '@/utils/bibles';
import { bookIdFromSlug, warmBibleTextOnce } from '@/utils/bibleText';
import { isBrowserOffline } from '@/utils/connectivity';

import '@locales/i18n';

/**
 * ONE ADDRESS FOR THE WHOLE BIBLE. The book and the place are search parameters, switched with the
 * History API instead of a router navigation: no server round trip, so a book never opened online
 * still opens offline once /bible has been seen (the offline shell keeps one page per address).
 * `/bible` lists the books, `/bible?book=1-timothy&at=1:18&tr=rst` opens a book at a verse of a Bible
 * (`tr`: the Bible the place is numbered in; the book opens in the Bible this device reads). A
 * reference tapped elsewhere adds `to` (the passage to light) and `from` (the way back) — the
 * address is built and read by `utils/bibleLink.ts`.
 */
export default function BiblePage() {
  const { t, i18n } = useTranslation();
  const locale = resolveAppLocale(i18n.language);
  const searchParams = useSearchParams();
  const slug = searchParams?.get('book') ?? null;
  const place = parsePlaceParam(searchParams?.get('at'));
  const placeBible = searchParams?.get('tr');
  const passageEnd = parsePassageEnd(searchParams?.get('to'));
  const cameFrom = wayBackPath(searchParams?.get('from'));
  const bookId = slug ? bookIdFromSlug(slug) : undefined;
  const [lastPlace, setLastPlace] = useState<LastPlace | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  // The Bible this device reads, known after mount (it lives in browser storage); nothing is opened
  // before it is known, so a book is never fetched in one Bible and then again in another.
  const [bible, setBible] = useState<BibleId | null>(null);
  // A Bible chosen in this visit stays chosen even when the device refuses to store it and the
  // interface's language changes; before any choice, the language decides.
  const chosenRef = useRef<BibleId | null>(null);

  useEffect(() => {
    setBible(chosenRef.current ?? readTranslation(locale));
  }, [locale]);

  const changeBible = useCallback((next: BibleId) => {
    chosenRef.current = next;
    saveTranslation(next);
    setBible(next);
  }, []);

  useEffect(() => {
    if (!slug) setLastPlace(readLastPlace());
  }, [slug]);

  // In the background: the whole text of the Bible being read onto the device (about 1.5 MB), again
  // whenever the connection returns or the person comes back to the tab, until every book is there.
  // Silent while it works; only a device that refuses to store is worth a word.
  useEffect(() => {
    if (!bible) return undefined;
    let alive = true;
    const run = () => {
      if (isBrowserOffline()) return;
      void warmBibleTextOnce({ bible }).then((result) => {
        if (alive) setStorageFailed(result.storageFailed);
      });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const idleHandle = idleWindow.requestIdleCallback?.(run);
    const timer = idleHandle === undefined ? window.setTimeout(run, 2000) : undefined;
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [bible]);

  const openBook = useCallback((nextSlug: string, at?: { chapter: number; verse: number; toVerse?: number }, from?: LastPlace) => {
    const query = new URLSearchParams({ book: nextSlug });
    if (at) query.set('at', `${at.chapter}:${at.verse}`);
    if (at && bible) query.set('tr', bible);
    // A passage (a cross reference followed) is lit on arrival, as a link's is.
    if (at?.toVerse) query.set('to', String(Math.max(at.toVerse, at.verse)));
    window.history.pushState(newEntryState(from), '', `/bible?${query.toString()}`);
  }, [bible]);

  const showBooks = useCallback(() => {
    window.history.pushState(null, '', '/bible');
    window.scrollTo({ top: 0 });
  }, []);

  if (!bible) return null;

  if (!slug) {
    return (
      <>
        {storageFailed ? (
          <p role="status" className="mx-auto mb-4 w-full max-w-7xl rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
            {t('bible.offlineSaveFailed')}
          </p>
        ) : null}
        <BibleBookList bible={bible} lastPlace={lastPlace} onOpen={openBook} onChangeBible={changeBible} />
      </>
    );
  }

  if (!bookId) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col items-start gap-3">
        <p className="text-sm text-gray-700 dark:text-gray-200">{t('bible.notFound')}</p>
        <button
          type="button"
          onClick={showBooks}
          className="min-h-11 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-semibold text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-950/40 dark:text-indigo-300"
        >
          {t('bible.allBooks')}
        </button>
      </div>
    );
  }

  // A new Bible is a new reader: it opens the book in it at the place the last one wrote down.
  return (
    <BibleBookReader
      key={`${bookId}:${bible}`}
      bookId={bookId}
      bible={bible}
      initialPlace={place}
      initialBible={isBibleId(placeBible) ? placeBible : bible}
      passageEnd={passageEnd}
      cameFrom={cameFrom}
      onOpenBook={openBook}
      onChangeBible={changeBible}
    />
  );
}
