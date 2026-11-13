'use client';

import { useId, useState } from 'react';

import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { editHistoryShown } from '@/utils/editHistory';
import { outlinePointText, projectOutlinePoint, projectOutlineSubpoint } from '@/utils/outlineDnd';
import { useTranslation } from '@locales/useTranslation';

import { outlinePointPlacementWords, outlineSubpointPlacementWords } from './outlinePointPlacementWords';

import type { OutlinePointPlacementHistoryPage } from '@/data-engine/types';
import type { SermonOutline } from '@/models/models';

type Entry = OutlinePointPlacementHistoryPage['entries'][number];
const PREFIX = 'planEditor.pointPlacement.';
const BUTTON = 'min-h-8 font-medium text-blue-700 hover:underline disabled:opacity-50 dark:text-blue-400';

export function OutlinePointPlacementHistory({ owner, id, collection, generation, outline, disabled, restore }: {
  owner: string; id: string; collection: 'sermons' | 'planTemplates'; generation: string; outline: SermonOutline;
  disabled: boolean; restore: (next: SermonOutline, pointId: string, subpoint: boolean) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const panel = useId();
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<Entry, OutlinePointPlacementHistoryPage | (Omit<OutlinePointPlacementHistoryPage, 'sermonId'> & { templateId: string })>({
    owner, id, generation,
    path: '/api/data-engine/documents/' + collection + '/' + encodeURIComponent(id) + '/outline-point-placement-history',
    resourceId: page => 'sermonId' in page ? page.sermonId : page.templateId,
  });
  const apply = async (next: SermonOutline, pointId: string, subpoint: boolean) => {
    setRestoring(true);
    setRestoreFailed(false);
    try { await restore(next, pointId, subpoint); }
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
          const next = entry.subpoint ? projectOutlineSubpoint(outline, entry.pointId, entry.earlier)
            : projectOutlinePoint(outline, entry.pointId, entry.earlier);
          const earlier = entry.subpoint ? outlineSubpointPlacementWords(entry.earlier, outline, t) : outlinePointPlacementWords(entry.earlier, outline, t);
          const kept = entry.subpoint ? outlineSubpointPlacementWords(entry.kept, outline, t) : outlinePointPlacementWords(entry.kept, outline, t);
          const name = outlinePointText(outline, entry.pointId) || t(PREFIX + 'unavailable');
          const alreadyThere = next === outline;
          return <li key={entry.id} className="break-words rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
            <p className="font-medium">{name}</p>
            <p>{earlier}</p>
            <p>{t(PREFIX + 'kept', { place: kept })}</p>
            <button type="button" className={BUTTON} disabled={disabled || restoring || !next || alreadyThere}
              onClick={() => { if (next) void apply(next, entry.pointId, Boolean(entry.subpoint)); }}>
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
