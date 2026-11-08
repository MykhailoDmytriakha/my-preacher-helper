import { useState } from 'react';

import { requestOwnerJson } from '@/services/ownerHttpTransport.client';

type HistoryPage<Entry> = { owner: string; generation: string; entries: Entry[]; nextCursor: string | null };
const unavailable = 'History unavailable';
const messages = { failed: unavailable, unavailable, timedOut: unavailable };

export function useOwnerHistory<Entry, Page extends HistoryPage<Entry>>({ owner, generation, id, path, resourceId }: {
  owner: string;
  generation: string;
  id: string;
  path: string;
  resourceId: (page: Page) => string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = async (cursor?: string) => {
    setLoading(true);
    setFailed(false);
    if (!cursor) setHistory(null);
    try {
      const params = new URLSearchParams({ generation, ...(cursor && { cursor }) });
      const { value } = await requestOwnerJson<Page>(path + '?' + params, { expectedOwner: owner, answerStatuses: [], messages });
      if (value.owner !== owner || resourceId(value) !== id || value.generation !== generation || !Array.isArray(value.entries)) throw new Error(unavailable);
      setHistory(previous => ({ ...value, entries: [...(cursor ? previous?.entries ?? [] : []), ...value.entries] }));
    } catch { setFailed(true); }
    finally { setLoading(false); }
  };
  const toggle = () => { setOpen(!open); if (!open) void load(); };
  return { open, history, loading, failed, toggle, load };
}
