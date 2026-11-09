'use client';

import { useId, useState } from 'react';

import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { useTranslation } from '@locales/useTranslation';

const control = 'min-h-8 text-sm text-indigo-700 hover:underline disabled:opacity-50 dark:text-indigo-300';

type Entry = { id: string; tag: string; value: boolean; winnerValue: boolean };
type HistoryPage<Row> = { owner: string; generation: string; entries: Row[]; nextCursor: string | null };

export function TagHistory<Row, Page extends HistoryPage<Row>>({ owner, id: resourceId, generation, path, identify, select, tags,
  disabled, onRestore }: {
  owner: string; id: string; generation: string; path: string; identify: (page: Page) => string;
  select: (entries: Row[]) => Entry[]; tags: readonly string[]; disabled: boolean;
  onRestore: (tag: string, present: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<Row, Page>({
    owner, generation, id: resourceId, resourceId: identify, path,
  });
  const entries = select(history?.entries ?? []);
  const state = (present: boolean) => t(present ? 'thought.tagHistory.added' : 'thought.tagHistory.removed');
  const restore = async (tag: string, present: boolean) => {
    setRestoring(true);
    setRestoreFailed(false);
    try { await onRestore(tag, present); }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };
  return <div>
    <button type="button" className={control} aria-expanded={open} aria-controls={id} onClick={toggle}>{t('thought.tagHistory.heading')}</button>
    {open && <section id={id} aria-label={t('thought.tagHistory.heading')} className="space-y-2 text-sm">
      {loading && <p role="status">{t('thought.tagHistory.loading')}</p>}
      {failed && <p role="alert">{t('thought.tagHistory.unavailable')}</p>}
      {restoreFailed && <p role="alert">{t('thought.tagHistory.restoreFailed')}</p>}
      {history && !entries.length && !history.nextCursor && <p>{t('thought.tagHistory.empty')}</p>}
      {entries.length > 0 && <ul className="space-y-2">{entries.map(entry => {
        const current = tags.includes(entry.tag) === entry.value;
        return <li key={JSON.stringify([entry.id, entry.tag])} className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
          <p className="break-words font-medium">{entry.tag} · {state(entry.value)}</p>
          <p>{t('thought.tagHistory.kept', { title: state(entry.winnerValue) })}</p>
          <button type="button" className={control} disabled={disabled || restoring || current}
            onClick={() => { void restore(entry.tag, entry.value); }}>
            {t(current ? 'thought.tagHistory.current' : 'thought.tagHistory.restore')}
          </button>
        </li>;
      })}</ul>}
      {history?.nextCursor && <button type="button" className={control} disabled={loading}
        onClick={() => { void load(history.nextCursor!); }}>{t('thought.tagHistory.more')}</button>}
    </section>}
  </div>;
}
