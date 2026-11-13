'use client';

import { useEffect, useRef, useState } from 'react';

import { fetchBookText, type BookText } from '@/utils/bibleText';
import { BIBLE_TEXT_NETWORK_FAILURE_HEADER } from '@/utils/bibleTextCache';
import { beginConnectivityRequest, getConnectivityStatus, reportServerUnreachable, subscribeToConnectivity } from '@/utils/connectivity';

import type { BibleId } from '@/utils/bibles';

const NO_TEXTS: ReadonlyMap<string, BookText> = new Map();

type BookRequest = { promise: Promise<BookText>; recovery: number };

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
 */
export function useBookTexts(books: readonly string[], bible: BibleId): ReadonlyMap<string, BookText> {
  const [kept, setKept] = useState<{ bible: BibleId; texts: ReadonlyMap<string, BookText> }>({ bible, texts: NO_TEXTS });
  const texts = kept.bible === bible ? kept.texts : NO_TEXTS;
  const requests = useRef(new Map<string, BookRequest>());
  const recovery = useRef(0);
  const reportedFailures = useRef(new Set<string>());
  const wanted = Array.from(new Set(books)).sort().join('|');
  useEffect(() => {
    let alive = true;
    let frame = 0;
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
    const missing = new Set((wanted ? wanted.split('|') : []).filter(book => !texts.has(book)));
    const listening = new Set<string>();
    const retried = new Set<string>();
    const retries = new Set<ReturnType<typeof setTimeout>>();
    const load = (book: string) => {
      if (!alive || !missing.has(book) || listening.has(book)) return;
      const key = `${bible}:${book}`;
      let request = requests.current.get(key);
      if (!request) {
        const fetchMissing: typeof fetch = async (...args) => {
          const started = beginConnectivityRequest();
          // Cache hits cannot confirm connectivity. A missed network request can
          // ask for one shared health check before the next confirmed recovery.
          const reportFailure = () => {
            if (reportedFailures.current.has(key)) return;
            reportedFailures.current.add(key);
            reportServerUnreachable(started);
          };
          try {
            const response = await fetch(...args);
            if (response.headers?.get(BIBLE_TEXT_NETWORK_FAILURE_HEADER) === '1') reportFailure();
            return response;
          } catch (error) {
            reportFailure();
            throw error;
          }
        };
        const current = { promise: fetchBookText(book, bible, { fetchFn: fetchMissing }), recovery: recovery.current };
        request = current;
        requests.current.set(key, current);
        void current.promise.then(
          () => { reportedFailures.current.delete(key); },
          () => { if (requests.current.get(key) === current) requests.current.delete(key); },
        );
      }
      const started = request.recovery;
      listening.add(book);
      void request.promise.then(
        (text) => {
          listening.delete(book);
          if (!alive) return;
          missing.delete(book);
          arrived.set(book, text);
          if (!frame) frame = window.requestAnimationFrame(draw);
        },
        () => {
          listening.delete(book);
          if (!alive || !getConnectivityStatus()) return;
          // A request started before reconnection can still fail after the health check.
          if (started !== recovery.current) load(book);
          else if (!retried.has(book)) {
            retried.add(book);
            const timer = setTimeout(() => {
              retries.delete(timer);
              if (getConnectivityStatus()) load(book);
            }, 500);
            retries.add(timer);
          }
        },
      );
    };
    const unsubscribe = subscribeToConnectivity(() => {
      retries.forEach(timer => clearTimeout(timer));
      retries.clear();
      if (!getConnectivityStatus()) return;
      recovery.current++;
      retried.clear();
      missing.forEach(load);
    });
    missing.forEach(load);
    return () => {
      alive = false;
      unsubscribe();
      retries.forEach(timer => clearTimeout(timer));
      if (frame) window.cancelAnimationFrame(frame);
    };
    // `texts` is read to skip books already here; refetching on its change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bible, wanted]);
  return texts;
}
