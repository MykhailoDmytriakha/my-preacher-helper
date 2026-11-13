'use client';

import { useEffect, useState } from 'react';

import { useReadAgainWhenReachable } from '@/hooks/useReadAgainWhenReachable';
import { fetchBookText, type BookText } from '@/utils/bibleText';
import { initialOfflineWorkerReady } from '@/utils/offlineWorkerStartup';

import type { BibleId } from '@/utils/bibles';

type LoadState = { status: 'loading' | 'error' } | { status: 'ready'; text: BookText };
export type BookOpeningStatus = LoadState['status'] | 'waiting-for-offline';

export function useBookOpening(bookId: string, bible: BibleId, attempt: number) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [canRead, setCanRead] = useState(false);

  // A book that did not come is said so, and read again when the server is back in reach, without the
  // person pressing "Retry"; a book that has opened is never read again
  // (`useReadAgainWhenReachable`, BUG-20261112-link-texts-stay-dots-after-reconnect).
  const { round, begin, due, asking, failed } = useReadAgainWhenReachable();
  useEffect(() => {
    begin(`${bible}:${bookId}:${attempt}`);
    // Not due: a pass the server's return began, with the server out of reach again — the card stays.
    if (!due()) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });
    const mark = asking();
    fetchBookText(bookId, bible).then(
      (text) => { if (!cancelled) setState({ status: 'ready', text }); },
      () => {
        if (cancelled) return;
        setState({ status: 'error' });
        failed(mark);
      },
    );
    return () => { cancelled = true; };
  }, [bible, bookId, attempt, round, begin, due, asking, failed]);

  useEffect(() => {
    const ready = initialOfflineWorkerReady();
    if (!ready) {
      setCanRead(true);
      return;
    }
    let open = true;
    void ready.then(() => { if (open) setCanRead(true); });
    return () => { open = false; };
  }, []);

  const status: BookOpeningStatus = state.status === 'ready' && !canRead ? 'waiting-for-offline' : state.status;
  const text = state.status === 'ready' && canRead ? state.text : null;
  return { status, text, readNow: () => setCanRead(true) };
}
