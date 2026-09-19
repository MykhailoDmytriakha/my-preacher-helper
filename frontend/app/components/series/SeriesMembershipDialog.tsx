'use client';

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import { DataMembershipStatus } from '@/data-engine/DataMembershipStatus';
import { useDataMembership } from '@/data-engine/react.client';
import { useDashboardSermons } from '@/hooks/useDashboardSermons';
import { useGroupsRead } from '@/hooks/useGroupsRead';
import { useAuth } from '@/providers/AuthProvider';
import { hydrateSeries } from '@/utils/seriesDocument';

import type { Series, SeriesItem } from '@/models/models';

type Member = Pick<SeriesItem, 'type' | 'refId'>;
export type SeriesMembershipDialogMode = 'sermon' | 'group' | 'reorder' | 'remove' | 'recover';
const same = (left: Member, right: Member) => left.type === right.type && left.refId === right.refId;

/** The complete stage opens before any selection; only explicit Save submits it. */
export function SeriesMembershipDialog({ seriesId, mode, member, recoveryId, onClose }: {
  seriesId: string; mode: SeriesMembershipDialogMode; member?: Member; recoveryId?: string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const action = useDataMembership(), attempted = useRef<object | null>(null);
  const [saving, setSaving] = useState(false);
  const open = async () => {
    if (recoveryId) await action.recover(recoveryId); else await action.begin();
    if (!recoveryId && mode === 'remove' && member) await action.update({ kind: 'remove', refs: [member] });
  };
  useEffect(() => {
    if (!action.ready || attempted.current === action.recoveryIdentity) return;
    attempted.current = action.recoveryIdentity; void open().catch(() => undefined);
  });
  const targetId = action.action?.kind === 'assign' ? action.action.targetId
    : action.action?.kind === 'reorder' ? action.action.seriesId : seriesId;
  const target = action.values.find(entry => entry.id === targetId);
  const series = target ? hydrateSeries({ ...target.value, id: targetId } as unknown as Series) : null;
  const editing = action.phase === 'editing';
  const kind = action.action?.kind ?? (mode === 'reorder' ? 'reorder' : mode === 'remove' ? 'remove' : 'assign');
  const selected = action.action?.kind === 'assign' ? action.action.refs : [];
  const changeSelection = (refs: Member[]) => action.update(refs.length ? { kind: 'assign', targetId, refs } : null);
  const save = async () => {
    if (saving || !editing || !action.durable || !action.action) return;
    setSaving(true);
    try { await action.save(); action.dismiss(); onClose(); }
    catch { /* The stage retains the original action and its error. */ }
    finally { setSaving(false); }
  };
  const cancel = async () => { await action.cancel(); onClose(); };
  const title = t(kind === 'remove' ? 'workspaces.series.actions.removeFromSeries'
    : kind === 'reorder' ? 'workspaces.series.actions.reorder'
      : mode === 'group' ? 'workspaces.series.actions.addGroup' : 'workspaces.series.actions.addSermon');
  return <FormDialog title={title} eyebrow={series?.title} onClose={onClose}>
    <div className="mt-4 space-y-4">
      <DataMembershipStatus action={{ ...action, retry: action.phase ? action.retry : open }} onDiscarded={onClose} />
      {editing && series && kind === 'assign' && <fieldset disabled={saving}>
        {mode !== 'group' && <SermonChoices current={series.items ?? []} selected={selected} onChange={changeSelection} />}
        {(mode === 'group' || mode === 'recover') && <GroupChoices current={series.items ?? []} selected={selected} onChange={changeSelection} />}
      </fieldset>}
      {editing && series && kind === 'reorder' && <ReorderChoices items={series.items ?? []} disabled={saving}
        onChange={itemIds => action.update({ kind: 'reorder', seriesId: targetId, itemIds })} />}
      {kind === 'remove' && <p>{t('workspaces.series.actions.membershipRemoveHint')}</p>}
      {editing && <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <FormActions onCancel={() => { void cancel().catch(() => undefined); }} cancelLabel={t('common.cancel')}
          submitLabel={t('common.save')} saving={saving} submitDisabled={!action.durable || !action.action} />
      </form>}
    </div>
  </FormDialog>;
}

interface ChoicesProps { current: SeriesItem[]; selected: Member[]; onChange: (refs: Member[]) => Promise<void> }
function SermonChoices(props: ChoicesProps) {
  const source = useDashboardSermons();
  return <MemberChoices {...props} type="sermon" rows={source.sermons.map(sermon => ({ id: sermon.id, title: sermon.title }))}
    loading={source.loading} error={source.error} />;
}
function GroupChoices(props: ChoicesProps) {
  const { user } = useAuth(), source = useGroupsRead(user?.uid ?? null);
  return <MemberChoices {...props} type="group" rows={source.groups.map(group => ({ id: group.id, title: group.title }))}
    loading={source.loading} error={source.error} />;
}
function MemberChoices({ type, rows, loading, error, current, selected, onChange }: ChoicesProps & {
  type: Member['type']; rows: { id: string; title: string }[]; loading: boolean; error: unknown;
}) {
  const { t } = useTranslation(), [query, setQuery] = useState('');
  const selectedOfType = selected.filter(ref => ref.type === type);
  const choices = [...rows, ...selectedOfType.filter(ref => !rows.some(row => row.id === ref.refId)).map(ref => ({ id: ref.refId, title: t('common.unknown') }))]
    .filter(row => !current.some(item => same(item, { type, refId: row.id })) || selectedOfType.some(ref => ref.refId === row.id))
    .filter(row => row.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <div className="space-y-3">
    <input aria-label={t('common.search')} value={query} onChange={event => setQuery(event.target.value)} className="w-full rounded-lg border bg-transparent px-3 py-2" />
    {loading && <p>{t('common.loading')}</p>}
    {Boolean(error) && <p role="alert">{t('dataSync.readFailed')}</p>}
    <div className="max-h-80 space-y-2 overflow-auto">{choices.map(row => {
      const ref = { type, refId: row.id }, checked = selected.some(item => same(item, ref));
      return <label key={row.id} className="flex gap-3 rounded-lg border p-3">
        <input type="checkbox" checked={checked} onChange={() => {
          void onChange(checked ? selected.filter(item => !same(item, ref)) : [...selected, ref]).catch(() => undefined);
        }} /><span>{row.title}</span>
      </label>;
    })}</div>
  </div>;
}

function ReorderChoices({ items, disabled, onChange }: { items: SeriesItem[]; disabled: boolean; onChange: (ids: string[]) => Promise<void> }) {
  const { t } = useTranslation(), { user } = useAuth();
  const sermons = useDashboardSermons(), groups = useGroupsRead(user?.uid ?? null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const move = (from: number, to: number) => {
    if (disabled || from < 0 || to < 0 || to >= items.length || from === to) return;
    void onChange(arrayMove(items, from, to).map(item => item.id)).catch(() => undefined);
  };
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
    if (over) move(items.findIndex(item => item.id === active.id), items.findIndex(item => item.id === over.id));
  }}><SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
    <div className="space-y-2">{items.map((item, index) => <ReorderRow key={item.id} id={item.id} index={index}
      title={(item.type === 'sermon' ? sermons.sermons : groups.groups).find(row => row.id === item.refId)?.title || t('common.unknown')}
      count={items.length} disabled={disabled} move={direction => move(index, index + direction)} />)}</div>
  </SortableContext></DndContext>;
}
function ReorderRow({ id, index, title, count, disabled, move }: {
  id: string; index: number; title: string; count: number; disabled: boolean; move: (direction: number) => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id, disabled });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="flex items-center justify-between gap-3 rounded-lg border p-3">
    <button type="button" {...attributes} {...listeners} disabled={disabled} className="touch-none cursor-grab rounded border px-2 py-1"
      aria-label={`${t('workspaces.series.detail.dragToReorder')}: ${title}`}>⠿</button>
    <span className="flex-1">{index + 1}. {title}</span>
    <div className="flex gap-2">{[-1, 1].map(direction => <button key={direction} type="button"
      disabled={disabled || index + direction < 0 || index + direction >= count}
      className="rounded border px-2 py-1 disabled:opacity-40" aria-label={`${t(direction < 0 ? 'common.moveUp' : 'common.moveDown')}: ${title}`}
      onClick={() => move(direction)}>{direction < 0 ? '↑' : '↓'}</button>)}</div>
  </div>;
}
