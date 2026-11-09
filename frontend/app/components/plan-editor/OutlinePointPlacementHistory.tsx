'use client';

import { useId, useState } from 'react';

import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { editHistoryShown } from '@/utils/editHistory';
import { outlinePointText, projectOutlinePoint } from '@/utils/outlineDnd';
import { useTranslation } from '@locales/useTranslation';

import { outlinePointPlacementWords } from './outlinePointPlacementWords';

import type { OutlinePointPlacementHistoryPage } from '@/data-engine/types';
import type { SermonOutline } from '@/models/models';

type Entry = OutlinePointPlacementHistoryPage['entries'][number];
const PREFIX = 'planEditor.pointPlacement.';
const BUTTON = 'min-h-8 font-medium text-blue-700 hover:underline disabled:opacity-50 dark:text-blue-400';

export function OutlinePointPlacementHistory({ owner, sermonId, generation, outline, disabled, restore }: {
  owner: string; sermonId: string; generation: string; outline: SermonOutline;
  disabled: boolean; restore: (next: SermonOutline, pointId: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const panel = useId();
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<Entry, OutlinePointPlacementHistoryPage>({
    owner, id: sermonId, generation,
    path: '/api/data-engine/documents/sermons/' + encodeURIComponent(sermonId) + '/outline-point-placement-history',
    resourceId: page => page.sermonId,
  });
  const apply = async (next: SermonOutline, pointId: string) => {
    setRestoring(true);
    setRestoreFailed(false);
    try { await restore(next, pointId); }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };
  const heading = t(PREFIX + 'history');
  if (!editHistoryShown()) return null;
  return <div className="mb-2 text-sm">
    <button type="button" aria-expanded={open} aria-controls={panel} className={BUTTON} disabled={loading} onClick={toggle}>{heading}</button>
    {open && <section id={panel} aria-label={heading} className="space-y-2">
      {loading && <p role="status">{t(PREFIX + 'loading')}</p>}
      {failed && <p role="alert">{t(PREFIX + 'readFailed')}</p>}
      {restoreFailed && <p role="alert">{t(PREFIX + 'restoreFailed')}</p>}
      {history && !history.entries.length && !history.nextCursor && <p>{t(PREFIX + 'empty')}</p>}
      {Boolean(history?.entries.length) && <ul className="space-y-2">
        {history?.entries.map(entry => {
          const next = projectOutlinePoint(outline, entry.pointId, entry.earlier);
          const name = outlinePointText(outline, entry.pointId) || t(PREFIX + 'unavailable');
          const alreadyThere = next === outline;
          return <li key={entry.id} className="break-words rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
            <p className="font-medium">{name}</p>
            <p>{outlinePointPlacementWords(entry.earlier, outline, t)}</p>
            <p>{t(PREFIX + 'kept', { place: outlinePointPlacementWords(entry.kept, outline, t) })}</p>
            <button type="button" className={BUTTON} disabled={disabled || restoring || !next || alreadyThere}
              onClick={() => { if (next) void apply(next, entry.pointId); }}>
              {t(PREFIX + (alreadyThere ? 'current' : 'restore'))}
            </button>
          </li>;
        })}
      </ul>}
      {history?.nextCursor && <button type="button" className={BUTTON} disabled={loading} onClick={() => void load(history.nextCursor!)}>
        {t(PREFIX + 'more')}
      </button>}
    </section>}
  </div>;
}
