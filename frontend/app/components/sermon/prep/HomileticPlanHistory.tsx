'use client';

import { useId, useState } from 'react';

import { serviceOrderPlacementWords } from '@/components/care/serviceOrderPlacementWords';
import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { editHistoryShown } from '@/utils/editHistory';
import { projectServiceOrderStep } from '@/utils/serviceOrderStepPlacement';
import { useTranslation } from '@locales/useTranslation';

import type { PreparationPlanBinding } from './PreparationPlanList';
import type { HomileticHistoryChange, HomileticHistoryPage, HomileticList } from '@/data-engine/homileticPlan';
import type { PreparationPlanItem } from '@/utils/preparationFieldValues';

type Entry = HomileticHistoryPage['entries'][number];
const prefix = 'dataSync.exegeticalHistory.';
const buttonClass = 'min-h-8 font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400';

function restoreChange(rows: PreparationPlanItem[], change: HomileticHistoryChange): PreparationPlanItem[] | undefined {
  const row = rows.find(item => item.id === change.rowId);
  if (!row) return;
  if (change.kind === 'title') {
    return row.title === change.earlier ? rows : rows.map(item => item === row ? { ...item, title: change.earlier } : item);
  }
  return projectServiceOrderStep(rows, row.id, {
    previous: change.earlier.previous?.id ?? null, next: change.earlier.next?.id ?? null,
  });
}

export function HomileticPlanHistory({ identity, list, binding }: {
  identity: NonNullable<PreparationPlanBinding['documentIdentity']>;
  list: HomileticList;
  binding: PreparationPlanBinding;
}) {
  const { t } = useTranslation();
  const panel = useId();
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const route = list === 'updatedPlan' ? 'homiletic-updated-plan-history' : 'homiletic-sermon-plan-history';
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<Entry, HomileticHistoryPage>({
    ...identity, path: '/api/data-engine/documents/sermons/' + encodeURIComponent(identity.id) + '/' + route,
    resourceId: page => page.list === list ? page.sermonId : undefined,
  });
  const restore = async (change: HomileticHistoryChange) => {
    setRestoring(true);
    setRestoreFailed(false);
    try {
      await binding.edit(rows => {
        const next = restoreChange(rows, change);
        if (!next) throw new Error('The point or its original neighbors are no longer available');
        return next;
      }, change.kind === 'position' ? { homileticMove: { list, rowId: change.rowId } } : undefined);
    } catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };
  if (!editHistoryShown()) return null;
  const heading = t(prefix + 'heading');
  return <div className="mt-2 space-y-2 text-sm">
    <button type="button" className={buttonClass} aria-expanded={open} aria-controls={panel} disabled={loading}
      onClick={toggle}>{heading}</button>
    {open && <section id={panel} aria-label={heading} className="space-y-2">
      {loading && <p role="status">{t(prefix + 'loading')}</p>}
      {failed && <p role="alert">{t(prefix + 'unavailable')}</p>}
      {restoreFailed && <p role="alert">{t(prefix + 'restoreFailed')}</p>}
      {history?.entries.length === 0 && <p>{t(prefix + 'empty')}</p>}
      {Boolean(history?.entries.length) && <ul className="space-y-2">
        {history?.entries.flatMap(entry => entry.changes.map((change, index) => {
          const next = restoreChange(binding.value, change);
          const position = change.kind === 'position';
          const earlier = position ? serviceOrderPlacementWords(change.earlier, t) : change.earlier;
          const kept = position ? serviceOrderPlacementWords(change.kept, t) : change.kept;
          return <li key={entry.id + ':' + index} className="break-words rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
            {position && change.title && <p className="font-medium">{change.title}</p>}
            <p>{earlier}</p>
            <p>{change.origin === 'comparison' ? t('dataSync.homileticHistory.comparison') : t(prefix + 'kept', { title: kept })}</p>
            <button type="button" className={buttonClass}
              disabled={restoring || binding.busy || binding.dirty || Boolean(binding.decision) || !next || next === binding.value}
              onClick={() => void restore(change)}>
              {t(position ? 'serviceOrders.placementHistory.restore' : prefix + 'restore')}
            </button>
          </li>;
        }))}
      </ul>}
      {history?.nextCursor && <button type="button" disabled={loading} className={buttonClass}
        onClick={() => void load(history.nextCursor!)}>{t(prefix + 'more')}</button>}
    </section>}
  </div>;
}
