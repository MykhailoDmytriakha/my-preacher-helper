'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { usePublishShellTitle } from '@/components/navigation/shellTitles';
import { RecordUnavailable } from '@/components/RecordUnavailable';
import { EngineCreateSermonModal } from '@/components/sermon/EngineCreateSermonModal';
import { SeriesDetailSkeleton } from '@/components/skeletons/SeriesDetailSkeleton';
import FormDialog from '@/components/ui/FormDialog';
import { DataCollectionStatus } from '@/data-engine/DataCollectionStatus';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { DataDocumentProvider, useDataDocument, useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { useDashboardSermons } from '@/hooks/useDashboardSermons';
import { useGroupsRead } from '@/hooks/useGroupsRead';
import { useSeriesDataCollection } from '@/hooks/useSeriesDataCollection';
import { useAuth } from '@/providers/AuthProvider';
import { listReadState } from '@/utils/listReadState';
import { hydrateSeries } from '@/utils/seriesDocument';
import { useTranslation } from '@locales/useTranslation';

import { EngineEditSeriesModal, SERIES_METADATA_SELECTION } from './EngineEditSeriesModal';
import { RetainedSeriesMetadata } from './RetainedSeriesMetadata';
import { SeriesDetailView } from './SeriesDetailView';
import SeriesItemCard from './SeriesItemCard';
import { SeriesMembershipDialog, type SeriesMembershipDialogMode } from './SeriesMembershipDialog';

import type { Series, SeriesItem } from '@/models/models';

const SERIES_LABEL = 'navigation.series';

type MembershipDialog = { mode: SeriesMembershipDialogMode; member?: Pick<SeriesItem, 'type' | 'refId'>; recoveryId?: string };

/** This screen has no autosave: a deliberate conflict choice must submit its replacement. */
async function saveKeptSeries(document: Pick<ReturnType<typeof useDataDocument>, 'keepLocal' | 'save'>): Promise<void> {
  await document.keepLocal();
  await document.save();
}

export function EngineSeriesDetail({ seriesId }: { seriesId: string }) {
  return <DataDocumentProvider resource={{ collection: 'series', id: seriesId }} options={{ slot: 'series', autoSave: false, readOnlyCopy: true }}>
    <SeriesWorkspace seriesId={seriesId} />
  </DataDocumentProvider>;
}
function SeriesWorkspace({ seriesId }: { seriesId: string }) {
  const { t } = useTranslation(), router = useRouter(), { user } = useAuth();
  const document = useDataDocument({ collection: 'series', id: seriesId }, { autoSave: false });
  usePublishShellTitle('series', seriesId, document.data);
  const unavailable = document.presence?.kind === 'absent' || document.presence?.kind === 'deleting';
  const readOnly = document.readOnly || unavailable;
  const collection = useSeriesDataCollection(true, user?.uid ?? null);
  const sermons = useDashboardSermons(), groups = useGroupsRead(user?.uid ?? null);
  const [editing, setEditing] = useState(false), [deleting, setDeleting] = useState(false);
  const [creatingSermon, setCreatingSermon] = useState(false);
  const [membership, setMembership] = useState<MembershipDialog | null>(null);
  const metadata = useDataForm({ collection: 'series', id: seriesId }, 'series-metadata', SERIES_METADATA_SELECTION);
  const metadataRecovery = useRecoveryDiscovery({ identity: metadata.recoveryIdentity, enabled: !metadata.loading,
    version: JSON.stringify([editing, metadata.active, metadata.dirty]),
    list: async () => (await metadata.listRecoverable()).map(source => ({ id: source.scopeId,
      title: String(source.record.baseline.value?.title ?? t(SERIES_LABEL)),
      preview: source.record.stage.filter(field => field.exists && typeof field.value === 'string').map(field => String(field.value)).join('\n').slice(0, 500),
      discard: () => metadata.discardRecovery(source) })),
    recover: async id => { await metadata.recover(id); setEditing(true); } });
  const recovery = useRecoveryDiscovery({ identity: document.recoveryIdentity,
    enabled: !document.loading && document.status !== null,
    version: JSON.stringify([document.status?.phase, document.confirmed?.metadata?.revision, editing]),
    list: async () => (await document.listRecoverable()).map(source => ({ id: source.id,
      title: String(source.record.checkpoint.draft?.title ?? source.record.checkpoint.confirmed.value?.title ?? t(SERIES_LABEL)),
      discard: () => document.discardRecovery(source) })),
    recover: document.recover });
  const sync = <DataSyncStatus subject={document.recoveryIdentity} status={document.status} error={document.error} errorWords={document.errorWords} onRetry={document.retry}
    onKeepLocal={() => saveKeptSeries(document)} onAcceptRemote={document.acceptRemote}
    recoveryChoices={recovery.choices} recoveryLoading={recovery.loading} recoveryError={recovery.error}
    onRecover={recovery.recover} onDiscardRecovery={recovery.discard} />;
  const retainedMetadata = unavailable && (metadata.active || metadata.dirty || metadataRecovery.choices.length > 0 || metadataRecovery.error) && <>
    <DataSyncStatus subject={metadata.recoveryIdentity} status={metadata.status} error={metadata.error} errorWords={metadata.errorWords}
      recoveryChoices={metadataRecovery.choices} recoveryLoading={metadataRecovery.loading} recoveryError={metadataRecovery.error}
      onRecover={metadataRecovery.recover} onRetry={metadata.retry} onDiscardRecovery={metadataRecovery.discard} />
    <RetainedSeriesMetadata value={metadata.data} />
  </>;
  if (!document.data) return <RecordUnavailable presence={document.presence} checking={document.loading} pageLoading={document.loading && !retainedMetadata} loadingFallback={<SeriesDetailSkeleton />}
    onBack={() => router.push('/series')} onRetry={document.retry}>{sync}{retainedMetadata}</RecordUnavailable>;
  const base = hydrateSeries({ ...document.data, id: seriesId } as unknown as Series);
  const projected = collection.series.find(series => series.id === seriesId);
  // Presentation only. Never feed a submitted collection projection into the metadata form's ancestor.
  const series = !readOnly && projected ? { ...base, items: projected.items, sermonIds: projected.sermonIds, seriesKind: projected.seriesKind } : base;
  const items = (series.items ?? []).map(item => ({ item,
    sermon: item.type === 'sermon' ? sermons.sermons.find(sermon => sermon.id === item.refId) : undefined,
    group: item.type === 'group' ? groups.groups.find(group => group.id === item.refId) : undefined }));
  const refresh = async () => { await Promise.all([document.retry(), collection.refreshSeries()]); };
  return <SeriesDetailView readOnly={readOnly} series={series} items={items}
    sermonsRead={listReadState(sermons)} groupsRead={listReadState(groups)} onBack={() => router.push('/series')}
    onAddSermons={() => setMembership({ mode: 'sermon' })} onAddGroups={() => setMembership({ mode: 'group' })}
    onEdit={() => setEditing(true)} onDelete={() => setDeleting(true)} onRefresh={() => { void refresh().catch(() => undefined); }}
    feedback={<>{unavailable && <RecordUnavailable presence={document.presence}
      onBack={() => router.push('/series')} onRetry={document.retry} />}{sync}{retainedMetadata}
      {!readOnly && !editing && (metadata.dirty || metadataRecovery.choices.length > 0 || metadataRecovery.error) && <section className="space-y-2 rounded-lg border p-3">
        <h2 className="font-semibold">{t('workspaces.series.metadataRecovery')}</h2>
        <DataSyncStatus subject={metadata.recoveryIdentity} status={metadata.dirty ? metadata.status : null} error={metadata.error} errorWords={metadata.errorWords}
          recoveryChoices={metadataRecovery.choices} recoveryLoading={metadataRecovery.loading} recoveryError={metadataRecovery.error}
          onRecover={metadataRecovery.recover} onDiscardRecovery={metadataRecovery.discard} />
        {metadata.dirty && <button type="button" className="underline" onClick={() => setEditing(true)}>{t('workspaces.series.editSeries')}</button>}
      </section>}
      <DataCollectionStatus state={collection.state} />
      {collection.error && <p role="alert">{t('dataSync.readFailed')}</p>}
    </>}
    reorderHint={<button type="button" className="underline" onClick={() => setMembership({ mode: 'reorder' })}>
      {t('workspaces.series.actions.reorder')}</button>}
    itemsContent={<div className="space-y-4">{items.map((entry, index) => <SeriesItemCard key={entry.item.id} id={entry.item.id}
      position={index + 1} resolvedItem={entry} sortable={false} onRemove={readOnly ? undefined : (type, refId) => setMembership({ mode: 'remove', member: { type, refId } })} />)}</div>}>
    {!readOnly && editing && <EngineEditSeriesModal seriesId={seriesId} onClose={() => setEditing(false)} />}
    {!readOnly && membership && <SeriesMembershipDialog key={membership.recoveryId ?? `${membership.mode}:${membership.member?.refId ?? ''}`}
      seriesId={seriesId} {...membership} onClose={() => setMembership(null)}
      onCreateSermon={() => { setMembership(null); setCreatingSermon(true); }} />}
    {!readOnly && creatingSermon && <EngineCreateSermonModal preSelectedSeriesId={seriesId} onClose={() => setCreatingSermon(false)}
      onQueued={() => setCreatingSermon(false)} />}
    {!readOnly && deleting && <DeleteSeries seriesId={seriesId} onClose={() => setDeleting(false)} onDeleted={() => router.replace('/series')} />}
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
      <DataSyncStatus subject={document.recoveryIdentity} status={document.status} error={document.error} errorWords={document.errorWords} onRetry={document.retry}
        onAcceptRemote={document.acceptRemote} onKeepLocal={() => saveKeptSeries(document)} />
      <button type="button" disabled={busy || !document.status?.canRemove} className="rounded-lg bg-red-600 px-4 py-2 text-white disabled:opacity-50"
        onClick={() => { void remove(); }}>{t('workspaces.series.deleteSeries')}</button>
    </div>
  </FormDialog>;
}
