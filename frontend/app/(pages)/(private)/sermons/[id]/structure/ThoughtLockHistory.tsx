'use client';

import { useId, useState } from 'react';

import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { useTranslation } from '@locales/useTranslation';

import type { ShownThoughtIdentity } from './useEngineStructureWriter';
import type { ThoughtLockHistoryPage } from '@/data-engine/thoughtLockAction';
import type { Thought } from '@/models/models';

type Entry = ThoughtLockHistoryPage['entries'][number];
const control = 'min-h-8 text-sm text-indigo-700 hover:underline disabled:opacity-50 dark:text-indigo-300';

export function ThoughtLockHistory({ owner, sermonId, generation, thoughts, disabled, onRestore }: {
  owner: string;
  sermonId: string;
  generation: string;
  thoughts: readonly Thought[];
  disabled: boolean;
  onRestore: (thoughts: readonly ShownThoughtIdentity[], isLocked: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<Entry, ThoughtLockHistoryPage>({
    owner, generation, id: sermonId, resourceId: page => page.sermonId,
    path: '/api/data-engine/documents/sermons/' + encodeURIComponent(sermonId) + '/thought-lock-history',
  });
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const byId = new Map(thoughts.map(thought => [thought.id, thought]));
  const entries = history?.entries.flatMap(entry => entry.fields.flatMap(field => {
    const thought = byId.get(field.rowId);
    return thought && thought.date === field.rowCreatedAt ? [{ id: entry.id, thought, field }] : [];
  })) ?? [];
  const heading = t('structure.thoughtLockHistory');
  const state = (value: boolean) => t(value ? 'structure.locked' : 'structure.unlocked');
  const restore = async (thought: Thought, value: boolean) => {
    setRestoring(true);
    setRestoreFailed(false);
    try { await onRestore([thought], value); }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };

  return <div className="mb-3">
    <button type="button" className={control} aria-expanded={open} aria-controls={id} onClick={toggle}>{heading}</button>
    {open && <section id={id} aria-label={heading} className="space-y-2 text-sm">
      {loading && <p role="status">{t('common.statusHistoryLoading')}</p>}
      {failed && <p role="alert">{t('common.statusHistoryUnavailable')}</p>}
      {restoreFailed && <p role="alert">{t('common.statusHistoryRestoreFailed')}</p>}
      {history && !entries.length && !history.nextCursor && <p>{t('common.statusHistoryEmpty')}</p>}
      {entries.length > 0 && <ul className="space-y-2">{entries.map(({ id: entryId, thought, field }) => {
        const alreadyShown = Boolean(thought.isLocked) === field.value;
        return <li key={JSON.stringify([entryId, thought.id])} className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
          <p className="line-clamp-2 break-words font-medium">{thought.text}</p>
          <p>{state(field.value)}</p>
          <p>{t('common.statusHistoryKept', { title: state(field.winnerValue) })}</p>
          <button type="button" className={control} disabled={disabled || restoring || alreadyShown}
            onClick={() => void restore(thought, field.value)}>
            {t(alreadyShown ? 'common.statusHistoryCurrent' : 'common.statusHistoryRestore')}
          </button>
        </li>;
      })}</ul>}
      {history?.nextCursor && <button type="button" className={control} disabled={loading}
        onClick={() => void load(history.nextCursor!)}>{t('common.statusHistoryMore')}</button>}
    </section>}
  </div>;
}
