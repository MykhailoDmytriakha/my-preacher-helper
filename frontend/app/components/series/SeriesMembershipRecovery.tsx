'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { isCollectionOnEngine, useDataMembership, useRecoveryDiscovery } from '@/data-engine/react.client';

const SeriesMembershipDialog = dynamic(() => import('./SeriesMembershipDialog').then(module => module.SeriesMembershipDialog), { ssr: false });
const EngineCreateSermonModal = dynamic(() => import('../sermon/EngineCreateSermonModal').then(module => module.EngineCreateSermonModal), { ssr: false });

/** One recovery owner per workspace, including after the originating page unmounts. */
export function SeriesMembershipRecovery() {
  return isCollectionOnEngine('series') || isCollectionOnEngine('sermons') ? <WorkspaceRecovery /> : null;
}
function WorkspaceRecovery() {
  const { t } = useTranslation(), actions = useDataMembership();
  const [selected, setSelected] = useState<{ identity: object; id: string; creation: boolean } | null>(null);
  const id = selected?.identity === actions.recoveryIdentity ? selected.id : null;
  const recovery = useRecoveryDiscovery({ identity: actions.recoveryIdentity, enabled: actions.ready,
    version: `${actions.recoveryVersion}:${id ?? ''}`,
    list: async () => (await actions.listRecoverable({ closedOnly: true }))
      .filter(record => !record.creation || record.creation.resource.collection === 'sermons').map(record => {
      if (record.creation) return { id: record.scopeId, title: String(record.creation.value.title || t('addSermon.newSermon')),
        preview: String(record.creation.value.verse || t('addSermon.newSermon')) };
      const action = record.action;
      const targetId = action?.kind === 'assign' ? action.targetId : action?.kind === 'reorder' ? action.seriesId : null;
      const target = targetId ? record.pins.find(pin => pin.baseline.resource.id === targetId) : null;
      return { id: record.scopeId, title: String(target?.predecessor?.value?.title ?? target?.baseline.value?.title ?? t('navigation.series')),
        preview: t(action?.kind === 'reorder' ? 'workspaces.series.actions.reorder'
          : action?.kind === 'remove' ? 'workspaces.series.actions.removeFromSeries' : 'workspaces.series.membershipAssignment') };
    }),
    recover: async id => {
      const record = (await actions.listRecoverable({ closedOnly: true })).find(record => record.scopeId === id);
      if (!record) throw new Error('This draft is no longer available');
      setSelected({ identity: actions.recoveryIdentity, id, creation: Boolean(record.creation) });
    } });
  return <>
    {!id && (recovery.choices.length > 0 || recovery.error) && <section className="mb-4 space-y-2 rounded-lg border border-amber-200 p-3 dark:border-amber-700">
      <h2 className="font-semibold">{t('workspaces.series.membershipRecovery')}</h2>
      <DataSyncStatus status={null} recoveryChoices={recovery.choices} recoveryLoading={recovery.loading}
        recoveryError={recovery.error} onListRecovery={recovery.refresh} onRecover={recovery.recover} />
    </section>}
    {id && (selected?.creation ? <EngineCreateSermonModal key={id} recoveryId={id}
      onClose={() => setSelected(null)} onQueued={() => setSelected(null)} />
      : <SeriesMembershipDialog key={id} mode="recover" recoveryId={id} seriesId="" onClose={() => setSelected(null)} />)}
  </>;
}
