'use client';

import { useEffect, useState } from 'react';

import { fetchBookText, type BookText } from '@/utils/bibleText';

import type { BibleId } from '@/utils/bibles';

/**
 * The texts of the books the links point into, fetched as they are needed (kept on the device by the
 * worker). Books that arrive together are drawn together, once a frame: the rest of a verse's links as
 * verses ask for twenty books at once, and a list drawn again for each one flickered on an iPad.
 */
export function useBookTexts(books: readonly string[], bible: BibleId): ReadonlyMap<string, BookText> {
  const [texts, setTexts] = useState<ReadonlyMap<string, BookText>>(new Map());
  const wanted = books.join('|');
  useEffect(() => {
    let alive = true;
    let frame = 0;
    const arrived = new Map<string, BookText>();
    const draw = () => {
      frame = 0;
      const batch = new Map(arrived);
      arrived.clear();
      setTexts((known) => {
        const next = new Map(known);
        batch.forEach((text, book) => next.set(book, text));
        return next;
      });
    };
    for (const book of new Set(wanted ? wanted.split('|') : [])) {
      if (texts.has(book)) continue;
      fetchBookText(book, bible).then(
        (text) => {
          if (!alive) return;
          arrived.set(book, text);
          if (!frame) frame = window.requestAnimationFrame(draw);
        },
        () => undefined,
      );
    }
    return () => {
      alive = false;
      if (frame) window.cancelAnimationFrame(frame);
    };
    // `texts` is read to skip books already here; refetching on its change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bible, wanted]);
  return texts;
}
