'use client';

import { useId, useState } from 'react';

import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { editHistoryShown } from '@/utils/editHistory';
import { outlineTitleConflictTarget, outlineTitleField } from '@/utils/sermonNoteText';
import { useTranslation } from '@locales/useTranslation';

import type { OutlineTitleCollection, OutlineTitleHistoryPage } from '@/data-engine/outlineTitleAction';
import type { SermonOutline } from '@/models/models';
import type { OutlineTitleOpening } from '@/utils/sermonNoteText';

type Entry = OutlineTitleHistoryPage['entries'][number];
const button = 'min-h-8 font-medium text-blue-700 hover:underline disabled:opacity-50 dark:text-blue-400';

export function OutlineTitleHistory({ owner, collection, id, generation, outline, disabled, restore }: {
  owner: string; collection: OutlineTitleCollection; id: string; generation: string; outline: SermonOutline;
  disabled: boolean; restore: (opening: OutlineTitleOpening, title: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const panel = useId();
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<Entry, OutlineTitleHistoryPage>({
    owner, id, generation, path: '/api/data-engine/documents/' + collection + '/' + encodeURIComponent(id) + '/outline-title-history',
    resourceId: page => page.id,
  });
  const apply = async (opening: OutlineTitleOpening, title: string) => {
    setRestoring(true);
    setRestoreFailed(false);
    try { await restore(opening, title); }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };
  if (!editHistoryShown()) return null;
  const heading = t('common.titleHistory');
  return <div className="mb-2 text-sm">
    <button type="button" aria-expanded={open} aria-controls={panel} className={button} disabled={loading} onClick={toggle}>{heading}</button>
    {open && <section id={panel} aria-label={heading} className="space-y-2">
      {loading && <p role="status">{t('common.titleHistoryLoading')}</p>}
      {failed && <p role="alert">{t('common.titleHistoryUnavailable')}</p>}
      {restoreFailed && <p role="alert">{t('common.titleHistoryRestoreFailed')}</p>}
      {history && !history.entries.length && !history.nextCursor && <p>{t('common.titleHistoryEmpty')}</p>}
      {Boolean(history?.entries.length) && <ul className="space-y-2">
        {history?.entries.flatMap(entry => entry.fields.map(field => {
          const saved = outlineTitleField(outline, { kind: 'point', id: field.rowId }, collection === 'sermons' ? 'outline' : 'structure');
          const target = saved && outlineTitleConflictTarget(saved.path);
          const text = saved?.text;
          return <li key={entry.id + ':' + field.rowId} className="break-words rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
            <p>{field.value}</p>
            <p>{t('common.titleHistoryKept', { title: field.winnerValue })}</p>
            <button type="button" className={button} disabled={disabled || restoring || text === undefined || text === field.value}
              onClick={() => { if (target && text !== undefined) void apply({ target, text }, field.value); }}>
              {t(text === field.value ? 'common.titleHistoryCurrent' : 'common.titleHistoryRestore')}
            </button>
          </li>;
        }))}
      </ul>}
      {history?.nextCursor && <button type="button" className={button} disabled={loading} onClick={() => void load(history.nextCursor!)}>
        {t('common.titleHistoryMore')}
      </button>}
    </section>}
  </div>;
}
