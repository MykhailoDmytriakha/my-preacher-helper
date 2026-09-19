'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SeriesDetailSkeleton } from '@/components/skeletons/SeriesDetailSkeleton';
import FormDialog from '@/components/ui/FormDialog';
import { DataCollectionStatus } from '@/data-engine/DataCollectionStatus';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { DataDocumentProvider, useDataDocument, useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { useDashboardSermons } from '@/hooks/useDashboardSermons';
import { useGroupsRead } from '@/hooks/useGroupsRead';
import { useSeriesDataCollection } from '@/hooks/useSeriesDataCollection';
import { useAuth } from '@/providers/AuthProvider';
import { hydrateSeries } from '@/utils/seriesDocument';

import { EngineEditSeriesModal, SERIES_METADATA_SELECTION } from './EngineEditSeriesModal';
import { SeriesDetailView } from './SeriesDetailView';
import SeriesItemCard from './SeriesItemCard';
import { SeriesMembershipDialog, type SeriesMembershipDialogMode } from './SeriesMembershipDialog';

import type { Series, SeriesItem } from '@/models/models';

const SERIES_LABEL = 'navigation.series';

type MembershipDialog = { mode: SeriesMembershipDialogMode; member?: Pick<SeriesItem, 'type' | 'refId'>; recoveryId?: string };

export function EngineSeriesDetail({ seriesId }: { seriesId: string }) {
  return <DataDocumentProvider resource={{ collection: 'series', id: seriesId }} options={{ slot: 'series', autoSave: false }}>
    <SeriesWorkspace seriesId={seriesId} />
  </DataDocumentProvider>;
}
function SeriesWorkspace({ seriesId }: { seriesId: string }) {
  const { t } = useTranslation(), router = useRouter(), { user } = useAuth();
  const document = useDataDocument({ collection: 'series', id: seriesId }, { autoSave: false });
  const collection = useSeriesDataCollection(true, user?.uid ?? null);
  const sermons = useDashboardSermons(), groups = useGroupsRead(user?.uid ?? null);
  const [editing, setEditing] = useState(false), [deleting, setDeleting] = useState(false);
  const [membership, setMembership] = useState<MembershipDialog | null>(null);
  const metadata = useDataForm({ collection: 'series', id: seriesId }, 'series-metadata', SERIES_METADATA_SELECTION);
  const metadataRecovery = useRecoveryDiscovery({ identity: metadata.recoveryIdentity, enabled: !metadata.loading,
    version: JSON.stringify([editing, metadata.active, metadata.dirty]),
    list: async () => (await metadata.listRecoverable()).map(({ scopeId, record }) => ({ id: scopeId,
      title: String(record.baseline.value?.title ?? t(SERIES_LABEL)),
      preview: record.stage.filter(field => field.exists && typeof field.value === 'string').map(field => String(field.value)).join('\n').slice(0, 500) })),
    recover: async id => { await metadata.recover(id); setEditing(true); } });
  const recovery = useRecoveryDiscovery({ identity: document.recoveryIdentity,
    enabled: !document.loading && document.status !== null,
    version: JSON.stringify([document.status?.phase, document.confirmed?.metadata?.revision, editing]),
    list: async () => (await document.listRecoverable()).map(({ id, record }) => ({ id,
      title: String(record.checkpoint.draft?.title ?? record.checkpoint.confirmed.value?.title ?? t(SERIES_LABEL)) })),
    recover: document.recover });
  const sync = <DataSyncStatus status={document.status} error={document.error} onRetry={document.retry}
    onKeepLocal={document.keepLocal} onAcceptRemote={document.acceptRemote}
    recoveryChoices={recovery.choices} recoveryLoading={recovery.loading} recoveryError={recovery.error}
    onListRecovery={recovery.refresh} onRecover={recovery.recover} />;
  if (document.loading && !document.data) return <SeriesDetailSkeleton />;
  if (!document.data) return <div className="space-y-4">
    <button onClick={() => router.push('/series')}>{t(SERIES_LABEL)}</button>
    {sync}
    {!document.status && !document.error && <p>{t('dataSync.phase.deleted')}</p>}
  </div>;
  const base = hydrateSeries({ ...document.data, id: seriesId } as unknown as Series);
  const projected = collection.series.find(series => series.id === seriesId);
  // Presentation only. Never feed a submitted collection projection into the metadata form's ancestor.
  const series = projected ? { ...base, items: projected.items, sermonIds: projected.sermonIds, seriesKind: projected.seriesKind } : base;
  const items = (series.items ?? []).map(item => ({ item,
    sermon: item.type === 'sermon' ? sermons.sermons.find(sermon => sermon.id === item.refId) : undefined,
    group: item.type === 'group' ? groups.groups.find(group => group.id === item.refId) : undefined }));
  const refresh = async () => { await Promise.all([document.retry(), collection.refreshSeries()]); };
  return <SeriesDetailView series={series} items={items} onBack={() => router.push('/series')}
    onAddSermons={() => setMembership({ mode: 'sermon' })} onAddGroups={() => setMembership({ mode: 'group' })}
    onEdit={() => setEditing(true)} onDelete={() => setDeleting(true)} onRefresh={() => { void refresh().catch(() => undefined); }}
    feedback={<>{sync}
      {!editing && (metadata.dirty || metadataRecovery.choices.length > 0 || metadataRecovery.error) && <section className="space-y-2 rounded-lg border p-3">
        <h2 className="font-semibold">{t('workspaces.series.metadataRecovery')}</h2>
        <DataSyncStatus status={metadata.dirty ? metadata.status : null} error={metadata.error}
          recoveryChoices={metadataRecovery.choices} recoveryLoading={metadataRecovery.loading} recoveryError={metadataRecovery.error}
          onListRecovery={metadataRecovery.refresh} onRecover={metadataRecovery.recover} />
        {metadata.dirty && <button type="button" className="underline" onClick={() => setEditing(true)}>{t('workspaces.series.editSeries')}</button>}
      </section>}
      <DataCollectionStatus state={collection.state} />
      {collection.error && <p role="alert">{t('dataSync.readFailed')}</p>}
    </>}
    reorderHint={<button type="button" className="underline" onClick={() => setMembership({ mode: 'reorder' })}>
      {t('workspaces.series.actions.reorder')}</button>}
    itemsContent={<div className="space-y-4">{items.map((entry, index) => <SeriesItemCard key={entry.item.id} id={entry.item.id}
      position={index + 1} resolvedItem={entry} sortable={false} onRemove={(type, refId) => setMembership({ mode: 'remove', member: { type, refId } })} />)}</div>}>
    {editing && <EngineEditSeriesModal seriesId={seriesId} onClose={() => setEditing(false)} />}
    {membership && <SeriesMembershipDialog key={membership.recoveryId ?? `${membership.mode}:${membership.member?.refId ?? ''}`}
      seriesId={seriesId} {...membership} onClose={() => setMembership(null)} />}
    {deleting && <DeleteSeries seriesId={seriesId} onClose={() => setDeleting(false)} onDeleted={() => router.replace('/series')} />}
  </SeriesDetailView>;
}
function DeleteSeries({ seriesId, onClose, onDeleted }: { seriesId: string; onClose: () => void; onDeleted: () => void }) {
  const { t } = useTranslation(), document = useDataDocument({ collection: 'series', id: seriesId }, { autoSave: false });
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (busy || !document.status?.canRemove) return;
    setBusy(true);
    try { await document.remove(); onDeleted(); } catch { setBusy(false); }
  };
  return <FormDialog title={t('workspaces.series.deleteSeries')} onClose={onClose}>
    <div className="space-y-4"><p>{t('workspaces.series.deleteSeriesConfirm')}</p>
      <DataSyncStatus status={document.status} error={document.error} onRetry={document.retry}
        onAcceptRemote={document.acceptRemote} onKeepLocal={document.keepLocal} />
      <button type="button" disabled={busy || !document.status?.canRemove} className="rounded-lg bg-red-600 px-4 py-2 text-white disabled:opacity-50"
        onClick={() => { void remove(); }}>{t('workspaces.series.deleteSeries')}</button>
    </div>
  </FormDialog>;
}
