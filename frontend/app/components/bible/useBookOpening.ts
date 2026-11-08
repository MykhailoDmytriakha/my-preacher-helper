'use client';

import { useEffect, useState } from 'react';

import { fetchBookText, type BookText } from '@/utils/bibleText';
import { initialOfflineWorkerReady } from '@/utils/offlineWorkerStartup';

import type { BibleId } from '@/utils/bibles';

type LoadState = { status: 'loading' | 'error' } | { status: 'ready'; text: BookText };
export type BookOpeningStatus = LoadState['status'] | 'waiting-for-offline';

export function useBookOpening(bookId: string, bible: BibleId, attempt: number) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [canRead, setCanRead] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchBookText(bookId, bible).then(
      (text) => { if (!cancelled) setState({ status: 'ready', text }); },
      () => { if (!cancelled) setState({ status: 'error' }); },
    );
    return () => { cancelled = true; };
  }, [bible, bookId, attempt]);

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
