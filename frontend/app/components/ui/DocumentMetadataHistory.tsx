'use client';

import { useId, useState } from 'react';

import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { useTranslation } from '@locales/useTranslation';

type HistoryField<Field extends string> = { field: Field; value: string | null; winner: string | null };
type MetadataHistoryPage<Field extends string> = {
  owner: string; generation: string; seriesId?: string; councilId?: string; prayerId?: string; nextCursor: string | null;
  entries: { id: string; fields: HistoryField<Field>[] }[];
};

export function DocumentMetadataHistory<Field extends string>({ owner, collection, id, generation, current, disabled,
  labels, prefix, nullable, describeValue, onRestore }: {
  owner: string; collection: 'series' | 'councils' | 'prayerRequests'; id: string; generation: string;
  current: Partial<Record<Field, unknown>> | null; disabled: (field: Field) => boolean; labels: Record<Field, string>;
  prefix: string; nullable: readonly Field[]; describeValue: (field: Field, value: string | null) => string;
  onRestore: (field: Field, value: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const panel = useId();
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const { open, history, loading, failed, load, toggle } = useOwnerHistory<MetadataHistoryPage<Field>['entries'][number], MetadataHistoryPage<Field>>({
    owner, generation, id,
    path: '/api/data-engine/documents/' + collection + '/' + encodeURIComponent(id) + '/metadata-history',
    resourceId: page => collection === 'series' ? page.seriesId : collection === 'councils' ? page.councilId : page.prayerId,
  });
  const restore = async (entry: HistoryField<Field>) => {
    setRestoring(true);
    setRestoreFailed(false);
    try { await onRestore(entry.field, entry.value); }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };
  const heading = t(prefix + '.heading');
  return <div className="space-y-2 text-sm">
    <button type="button" className="min-h-8 font-medium text-blue-700 hover:underline dark:text-blue-400"
      aria-expanded={open} aria-controls={panel} disabled={loading} onClick={toggle}>{heading}</button>
    {open && <section id={panel} aria-label={heading} className="space-y-2">
      {loading && <p role="status">{t(prefix + '.loading')}</p>}
      {failed && <p role="alert">{t(prefix + '.unavailable')}</p>}
      {restoreFailed && <p role="alert">{t(prefix + '.restoreFailed')}</p>}
      {history?.entries.length === 0 && <p>{t(prefix + '.empty')}</p>}
      {history && history.entries.length > 0 && <ul className="space-y-2">
        {history.entries.flatMap(entry => entry.fields.map(field => {
          if (!Object.hasOwn(labels, field.field)) return null;
          const currentValue = current?.[field.field] ?? null;
          const same = currentValue === field.value;
          return <li key={entry.id + ':' + field.field} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
            <div className="min-w-0 break-words">
              <p className="font-medium">{t(labels[field.field])}</p>
              <p>{describeValue(field.field, field.value)}</p>
              <p>{t(prefix + '.kept', { value: describeValue(field.field, field.winner) })}</p>
            </div>
            <button type="button" disabled={disabled(field.field) || restoring || same || (field.value === null && !nullable.includes(field.field))}
              className="min-h-8 font-medium text-blue-700 hover:underline disabled:opacity-50 dark:text-blue-400"
              onClick={() => void restore(field)}>{t(same ? prefix + '.current' : prefix + '.restore')}</button>
          </li>;
        }))}
      </ul>}
      {history?.nextCursor && <button type="button" disabled={loading}
        className="min-h-8 font-medium text-blue-700 hover:underline dark:text-blue-400"
        onClick={() => void load(history.nextCursor!)}>{t(prefix + '.more')}</button>}
    </section>}
  </div>;
}
