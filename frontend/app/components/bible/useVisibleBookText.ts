import { useCallback, useEffect, useRef } from 'react';

import { bibleAssetFetch } from '@/utils/bibleAssetFetch';
import { fetchBookText } from '@/utils/bibleText';

import type { BibleId } from '@/utils/bibles';

/** Let an on-screen read tell the app it lost the server, once per book until the text arrives. */
export function useVisibleBookText() {
  const reportedFailures = useRef(new Set<string>());
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  return useCallback((book: string, bible: BibleId, stillWanted: () => boolean) => {
    const key = `${bible}:${book}`;
    const fetchFn = bibleAssetFetch(() => {
      if (!mounted.current || !stillWanted() || reportedFailures.current.has(key)) return false;
      reportedFailures.current.add(key);
      return true;
    });
    return fetchBookText(book, bible, { fetchFn }).then((text) => {
      reportedFailures.current.delete(key);
      return text;
    });
  }, []);
}
