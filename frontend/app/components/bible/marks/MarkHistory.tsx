'use client';

import { useId, useState } from 'react';

import { requestOwnerJson } from '@/services/ownerHttpTransport.client';
import { editHistoryShown } from '@/utils/editHistory';
import { useTranslation } from '@locales/useTranslation';

import { markLocation, markName } from './markPresentation';

import type { MarkHistorySession } from './markStore';
import type { BibleMarkHistoryPage, DisplacedMark } from '@/data-engine/bibleMarkStroke';
import type { BookText } from '@/utils/bibleText';

const unavailable = 'Mark history unavailable';
const messages = { failed: unavailable, unavailable, timedOut: unavailable };

export function MarkHistory({ session, text, disabled }: { session: MarkHistorySession; text: BookText | null; disabled: boolean }) {
  const { t } = useTranslation();
  const { owner, bookId, generation } = session;
  const panel = useId();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<BibleMarkHistoryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string>();
  const [error, setError] = useState<'load' | 'restore'>();
  const load = async (cursor?: string) => {
    setLoading(true);
    setError(undefined);
    if (!cursor) setPage(null);
    try {
      const params = new URLSearchParams({ generation, ...(cursor && { cursor }) });
      const { value } = await requestOwnerJson<BibleMarkHistoryPage>(`/api/data-engine/documents/bibleMarks/${encodeURIComponent(bookId)}/mark-history?${params}`,
        { expectedOwner: owner, answerStatuses: [], messages });
      if (value.owner !== owner || value.bookId !== bookId || value.generation !== generation || !Array.isArray(value.entries)) throw new Error(unavailable);
      setPage(previous => ({ ...value, entries: [...(cursor ? previous?.entries ?? [] : []), ...value.entries] }));
    } catch { setError('load'); }
    finally { setLoading(false); }
  };
  const restore = async (id: string, mark: DisplacedMark) => {
    setRestoring(id);
    setError(undefined);
    try {
      await session.restore(mark);
    } catch { setError('restore'); }
    finally { setRestoring(undefined); }
  };
  if (!editHistoryShown()) return null;
  return <div className="mb-2 text-sm">
    <button type="button" aria-expanded={open} aria-controls={panel} disabled={loading}
      className="min-h-8 text-xs font-medium text-blue-700 hover:underline dark:text-blue-400"
      onClick={() => { setOpen(!open); if (!open) void load(); }}>{t('bible.marks.historyTitle')}</button>
    {open && <section id={panel} aria-label={t('bible.marks.historyTitle')} className="space-y-2">
      {loading && <p role="status">{t('bible.marks.historyLoading')}</p>}
      {error && <p role="alert">{t(error === 'load' ? 'bible.marks.historyUnavailable' : 'bible.marks.historyRestoreFailed')}</p>}
      {page?.entries.length === 0 && <p>{t('bible.marks.historyEmpty')}</p>}
      {page && page.entries.length > 0 && <ul className="space-y-2">
        {page.entries.flatMap(entry => entry.marks.map((mark, index) => {
          const id = entry.id + ':' + index;
          const { verse, words } = markLocation(mark.verse, mark.first, mark.last, text);
          const applied = session.isApplied(mark);
          return <li key={id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
            <div>
              <p className="font-medium">{words ? verse + ' · ' + words : verse}</p>
              <p>{t('bible.marks.historyEntry', { earlier: markName(t, mark.colour), kept: markName(t, mark.winnerColour) })}</p>
            </div>
            <button type="button" disabled={disabled || Boolean(restoring) || applied}
              className="min-h-8 text-xs font-medium text-blue-700 hover:underline disabled:opacity-50 dark:text-blue-400"
              onClick={() => void restore(id, mark)}>{t(applied ? 'bible.marks.historyRestored' : 'bible.marks.historyRestore')}</button>
          </li>;
        }))}
      </ul>}
      {page?.nextCursor && <button type="button" disabled={loading}
        className="min-h-8 text-xs font-medium text-blue-700 hover:underline dark:text-blue-400"
        onClick={() => void load(page.nextCursor!)}>{t('bible.marks.historyMore')}</button>}
    </section>}
  </div>;
}
