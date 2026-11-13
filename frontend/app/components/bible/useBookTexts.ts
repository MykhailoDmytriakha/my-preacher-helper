'use client';

import { useEffect, useRef, useState } from 'react';

import { useReadAgainWhenReachable } from '@/hooks/useReadAgainWhenReachable';
import { fetchBookText, type BookText } from '@/utils/bibleText';

import type { BibleId } from '@/utils/bibles';

const NO_TEXTS: ReadonlyMap<string, BookText> = new Map();

/**
 * The texts of other books a reading screen quotes — a verse's links, the places of the trail — fetched
 * as they are needed (kept on the device by the worker). Books that arrive together are drawn together,
 * once a frame: the rest of a verse's links as verses ask for twenty books at once, and a list drawn
 * again for each one flickered on an iPad.
 *
 * Kept for one Bible: the list of books stays on screen while the person picks another translation, and
 * a text of the one left must not stand under the new one's places (Codex review, 2026-10-26). The books
 * asked for are a set — a trail names a book once per place — and a book still on its way is waited
 * for, not fetched again, when the set grows.
 *
 * A book that did not come is asked for again when the server is back in reach
 * (`useReadAgainWhenReachable`), once for one return of the server: a list opened without a network kept
 * "…" in place of the text until it was closed and opened again
 * (BUG-20261112-link-texts-stay-dots-after-reconnect). A list the person changes asks for every book it
 * lacks, as before.
 */
export function useBookTexts(books: readonly string[], bible: BibleId): ReadonlyMap<string, BookText> {
  const [kept, setKept] = useState<{ bible: BibleId; texts: ReadonlyMap<string, BookText> }>({ bible, texts: NO_TEXTS });
  const texts = kept.bible === bible ? kept.texts : NO_TEXTS;
  const requests = useRef(new Map<string, Promise<BookText>>());
  const wanted = Array.from(new Set(books)).sort().join('|');
  const { round, begin, due, asking, failed } = useReadAgainWhenReachable();
  /** The list on screen now: the death of a request for a book that has left it is nobody's wait any more. */
  const onScreen = useRef({ bible, wanted });
  onScreen.current = { bible, wanted };
  useEffect(() => {
    let alive = true;
    let frame = 0;
    begin(`${bible}:${wanted}`);
    const arrived = new Map<string, BookText>();
    const draw = () => {
      frame = 0;
      const batch = new Map(arrived);
      arrived.clear();
      setKept((known) => {
        const next = new Map(known.bible === bible ? known.texts : NO_TEXTS);
        batch.forEach((text, book) => next.set(book, text));
        return { bible, texts: next };
      });
    };
    for (const book of wanted ? wanted.split('|') : []) {
      if (texts.has(book)) continue;
      const key = `${bible}:${book}`;
      let request = requests.current.get(key);
      if (!request) {
        // Not due: asked for and refused since the server's last return (the late death of a neighbour's
        // request is no reason to ask for it a third time), or the server is out of reach again.
        if (!due(key)) continue;
        const mark = asking(key);
        request = fetchBookText(book, bible);
        requests.current.set(key, request);
        // A book that did not come is forgotten, to be asked for by the next list or when the server is
        // back in reach; one that came is read from `texts`.
        request.catch(() => {
          requests.current.delete(key);
          const now = onScreen.current;
          if (now.bible === bible && now.wanted.split('|').includes(book)) failed(mark, key);
        });
      }
      request.then(
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
  }, [bible, wanted, round, begin, due, asking, failed]);
  return texts;
}
