'use client';

import { useEffect, useRef } from 'react';

import { isCollectionOnEngine, useDataMembership } from '@/data-engine/react.client';
import { hydrateSeries } from '@/utils/seriesDocument';

import type { Series, SeriesItem } from '@/models/models';

/** Form adapter only: the engine owns the opening copies, selection and durable Save. */
export function useEngineSeriesField(member: Pick<SeriesItem, 'type' | 'refId'>) {
  const enabled = isCollectionOnEngine('series'), action = useDataMembership();
  const attempted = useRef<object | null>(null);
  useEffect(() => {
    if (!enabled || !action.ready || attempted.current === action.recoveryIdentity) return;
    attempted.current = action.recoveryIdentity;
    void action.begin().catch(() => undefined);
  });
  const rows = action.values.map(row => hydrateSeries({ ...row.value, id: row.id } as unknown as Series));
  const selected = rows.find(row => row.items?.some(item => item.type === member.type && item.refId === member.refId));
  return {
    enabled, action, seriesId: selected?.id ?? '', changed: action.action !== null,
    options: rows.map(row => ({ id: row.id, label: row.title || row.theme })),
    loading: action.phase === null,
    disabled: action.phase !== 'editing',
    unsettled: action.action !== null && (!action.durable || action.phase === 'saving'),
    change: (id: string) => action.update(id ? { kind: 'assign', targetId: id, refs: [member] } : { kind: 'remove', refs: [member] }),
    save: async () => { if (action.action) await action.save(); },
    cancel: async () => { if (action.phase === 'editing') await action.cancel(); },
    retry: () => action.phase ? action.retry() : action.begin(),
  };
}
