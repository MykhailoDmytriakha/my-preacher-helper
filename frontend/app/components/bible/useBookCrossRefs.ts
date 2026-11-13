'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useReadAgainWhenReachable } from '@/hooks/useReadAgainWhenReachable';
import { verseWords, type BookText } from '@/utils/bibleText';
import { countCrossReferences, loadCrossRefs, type CrossRefsBook } from '@/utils/crossReferences';
import { useTranslation } from '@locales/useTranslation';

import { useCrossReferencePrefs } from './crossReferencePrefs';

import type { RibbonCrossRefs } from './BookRibbon';
import type { CrossReferencePlace } from './CrossReferenceSheet';
import type { BibleId } from '@/utils/bibles';

/**
 * A book's cross references for a screen that draws it with `BookRibbon`: the counts for the chips,
 * the verse whose links are open, and its text for the window's head. The Bible page shows them while
 * cross references are on; a passage window over another screen only when that is asked for too
 * (`crossReferencePrefs`). The set is fetched only when it will be shown, and after the text.
 */
export function useBookCrossRefs(bookId: string, bible: BibleId, text: BookText | null, where: 'reader' | 'window') {
  const { t } = useTranslation();
  const prefs = useCrossReferencePrefs();
  const shown = prefs.show && (where === 'reader' || prefs.inWindow);
  const [set, setSet] = useState<CrossRefsBook | null>(null);
  const [openAt, setOpenAt] = useState<CrossReferencePlace | null>(null);

  // The text first: links mean nothing without it, and on a weak network it must not wait behind them.
  const textReady = Boolean(text);
  const { round, begin, due, asking, failed } = useReadAgainWhenReachable();
  useEffect(() => {
    begin(`${bookId}:${shown}:${textReady}`);
    // Not due: a pass the server's return began, with the server out of reach again.
    if (!shown || !textReady || !due()) return undefined;
    let alive = true;
    const mark = asking();
    loadCrossRefs(bookId).then(
      (loaded) => { if (alive) setSet(loaded); },
      // No set (offline before the first visit): the text reads as always, without chips — and the set is
      // asked for again when the server is back in reach (BUG-20261112-link-texts-stay-dots-after-reconnect).
      () => { if (alive) failed(mark); },
    );
    return () => { alive = false; };
  }, [bookId, shown, textReady, round, begin, due, asking, failed]);

  const counts = useMemo(
    () => (set && set.id === bookId && text ? countCrossReferences(set, bible, text.chapters) : null),
    [bible, bookId, set, text]
  );

  const ribbon = useMemo<RibbonCrossRefs | undefined>(() => (shown && counts ? {
    counts,
    mode: prefs.mode,
    onOpen: (chapter, verse) => setOpenAt({ chapter, verse }),
    verseLabel: (verse) => t('bible.crossRefs.verseRefs', { verse }),
    chipLabel: (verse, count) => t('bible.crossRefs.chip', { verse, number: count }),
  } : undefined), [counts, prefs.mode, shown, t]);

  const close = useCallback(() => setOpenAt(null), []);
  const verseText = openAt && text ? verseWords(text.chapters[openAt.chapter - 1]?.[openAt.verse - 1] ?? '') : undefined;

  return { set: set && set.id === bookId ? set : null, ribbon, openAt: shown ? openAt : null, close, verseText };
}
