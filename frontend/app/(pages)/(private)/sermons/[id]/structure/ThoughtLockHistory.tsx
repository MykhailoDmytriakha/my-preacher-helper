'use client';

import { useId, useState } from 'react';

import { readThoughtPlacementComparison, useOpenDocumentAnswerScopes } from '@/data-engine/react.client';
import { useOwnerHistory } from '@/hooks/useOwnerHistory';
import { editHistoryShown } from '@/utils/editHistory';
import { resolveThoughtOutlineLocation } from '@/utils/subPoints';
import { useTranslation } from '@locales/useTranslation';


import type { ShownThoughtIdentity } from './useEngineStructureWriter';
import type { ThoughtLockHistoryPage } from '@/data-engine/thoughtLockAction';
import type { ThoughtLocation } from '@/data-engine/thoughtPlacementAction';
import type { Sermon, SermonOutline, Thought } from '@/models/models';

type HistoryEntry<Value> = { id: string; fields: {
  rowId: string; rowCreatedAt: string; value: Value; winnerValue: Value;
}[] };
type HistoryProps = {
  owner: string; sermonId: string; generation: string; thoughts: readonly Thought[]; disabled: boolean;
};
const control = 'min-h-8 text-sm text-indigo-700 hover:underline disabled:opacity-50 dark:text-indigo-300';

function ThoughtActionHistory<Value>({ owner, sermonId, generation, thoughts, disabled, onRestore,
  route, heading, state, isCurrent, canRestore, placement }: HistoryProps & {
  onRestore: (thought: Thought, value: Value) => Promise<void>;
  route: string; heading: string; state: (value: Value) => string;
  isCurrent: (thought: Thought, value: Value) => boolean;
  canRestore?: (value: Value) => boolean;
  placement?: true;
}) {
  const { t } = useTranslation();
  const id = useId();
  const message = (key: 'Loading' | 'Unavailable' | 'Empty' | 'Kept' | 'Restore' | 'Current' | 'RestoreFailed' | 'More', title?: string) =>
    t((placement ? 'structure.thoughtPlacementHistoryLabels.' : 'common.statusHistory') + key, { title });
  const { open, history, loading, failed, toggle, load } = useOwnerHistory<HistoryEntry<Value>, Omit<ThoughtLockHistoryPage, 'entries'> & { entries: HistoryEntry<Value>[] }>({
    owner, generation, id: sermonId, resourceId: page => page.sermonId,
    path: '/api/data-engine/documents/sermons/' + encodeURIComponent(sermonId) + '/' + route,
  });
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const byId = new Map(thoughts.map(thought => [thought.id, thought]));
  const entries = history?.entries.flatMap(entry => entry.fields.flatMap(field => {
    const thought = byId.get(field.rowId);
    return thought && thought.date === field.rowCreatedAt ? [{ id: entry.id, thought, field }] : [];
  })) ?? [];
  const restore = async (thought: Thought, value: Value) => {
    setRestoring(true);
    setRestoreFailed(false);
    try { await onRestore(thought, value); }
    catch { setRestoreFailed(true); }
    finally { setRestoring(false); }
  };

  if (!editHistoryShown()) return null;
  return <div className="mb-3">
    <button type="button" className={control} aria-expanded={open} aria-controls={id} onClick={toggle}>{heading}</button>
    {open && <section id={id} aria-label={heading} className="space-y-2 text-sm">
      {loading && <p role="status">{message('Loading')}</p>}
      {failed && <p role="alert">{message('Unavailable')}</p>}
      {restoreFailed && <p role="alert">{message('RestoreFailed')}</p>}
      {history && !entries.length && !history.nextCursor && <p>{message('Empty')}</p>}
      {entries.length > 0 && <ul className="space-y-2">{entries.map(({ id: entryId, thought, field }) => {
        const alreadyShown = isCurrent(thought, field.value);
        return <li key={JSON.stringify([entryId, thought.id])} className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
          <p className="line-clamp-2 break-words font-medium">{thought.text}</p>
          <p>{state(field.value)}</p>
          <p>{message('Kept', state(field.winnerValue))}</p>
          <button type="button" className={control} disabled={disabled || restoring || alreadyShown || canRestore?.(field.value) === false}
            onClick={() => void restore(thought, field.value)}>
            {message(alreadyShown ? 'Current' : 'Restore')}
          </button>
        </li>;
      })}</ul>}
      {history?.nextCursor && <button type="button" className={control} disabled={loading}
        onClick={() => void load(history.nextCursor!)}>{message('More')}</button>}
    </section>}
  </div>;
}


export function ThoughtLockHistory({ onRestore, ...props }: HistoryProps & {
  onRestore: (thoughts: readonly ShownThoughtIdentity[], isLocked: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  return <ThoughtActionHistory<boolean> {...props} route="thought-lock-history" heading={t('structure.thoughtLockHistory')}
    state={value => t(value ? 'structure.locked' : 'structure.unlocked')}
    isCurrent={(thought, value) => Boolean(thought.isLocked) === value} onRestore={(thought, value) => onRestore([thought], value)} />;
}

export function thoughtLocationLabel(outline: SermonOutline | undefined, location: ThoughtLocation, unassigned: string, unavailable: string): string {
  if (!location.outlinePointId) return unassigned;
  const resolved = resolveThoughtOutlineLocation(outline, location.outlinePointId, location.subPointId);
  if (!resolved) return unavailable;
  const { outlinePoint, subPoint } = resolved;
  return location.subPointId ? outlinePoint.text + ' › ' + (subPoint?.text ?? unavailable) : outlinePoint.text;
}

export function ThoughtPlacementHistory({ outline, onRestore, ...props }: HistoryProps & {
  outline: SermonOutline | undefined;
  onRestore: (thought: ShownThoughtIdentity, location: ThoughtLocation) => Promise<void>;
}) {
  const { t } = useTranslation();
  return <ThoughtActionHistory<ThoughtLocation> {...props} route="thought-placement-history" placement heading={t('structure.thoughtPlacementHistory')}
    state={value => thoughtLocationLabel(outline, value, t('structure.unassigned'), t('structure.thoughtPlacementUnavailable'))}
    isCurrent={(thought, value) => (thought.outlinePointId ?? null) === value.outlinePointId && (thought.subPointId ?? null) === value.subPointId}
    canRestore={value => {
      if (!value.outlinePointId) return true;
      const point = resolveThoughtOutlineLocation(outline, value.outlinePointId, value.subPointId);
      return Boolean(point && (!value.subPointId || point.subPoint));
    }} onRestore={onRestore} />;
}


export function useThoughtPlacementComparison(checkpoint: Parameters<typeof readThoughtPlacementComparison>[0] | undefined, owner: string | null,
  sermon: Pick<Sermon, 'id' | 'outline'> | null) {
  const { t } = useTranslation();
  const answers = useOpenDocumentAnswerScopes();
  if (!checkpoint || !owner || !sermon) return;
  const [operationId] = Object.keys(checkpoint.pending);
  const owned = answers.filter(answer => answer.owner === owner && answer.resource.collection === 'sermons'
    && answer.resource.id === sermon.id && answer.operationIds.includes(operationId));
  if (!owned.length || owned.some(answer => answer.operationIds.length !== 1 || answer.laterSaves?.length)) return;
  const placement = readThoughtPlacementComparison(checkpoint);
  if (!placement) return;
  const label = (outline: SermonOutline | undefined, location: ThoughtLocation) =>
    thoughtLocationLabel(outline, location, t('structure.unassigned'), t('structure.thoughtPlacementUnavailable'));
  const stored = checkpoint.remoteCandidate?.value?.outline as unknown as SermonOutline | undefined;
  return { identity: placement.identity, title: t('structure.thoughtPlacementTitle'), valueKind: 'field' as const, scopedChoice: true as const,
    mine: placement.locations.map(value => value.text + ' · ' + label(value.mineUsesStoredOutline ? stored : sermon.outline, value.mine)).join('\n'),
    stored: placement.locations.map(value => value.text + ' · ' + label(stored, value.stored)).join('\n') };
}
