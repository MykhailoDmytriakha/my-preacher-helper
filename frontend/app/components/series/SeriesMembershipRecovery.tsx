'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { isCollectionOnEngine, useDataMembership, useRecoveryDiscovery } from '@/data-engine/react.client';

const SeriesMembershipDialog = dynamic(() => import('./SeriesMembershipDialog').then(module => module.SeriesMembershipDialog), { ssr: false });

/** One recovery owner per workspace, including after the originating page unmounts. */
export function SeriesMembershipRecovery() {
  return isCollectionOnEngine('series') ? <WorkspaceRecovery /> : null;
}
function WorkspaceRecovery() {
  const { t } = useTranslation(), actions = useDataMembership();
  const [selected, setSelected] = useState<{ identity: object; id: string } | null>(null);
  const id = selected?.identity === actions.recoveryIdentity ? selected.id : null;
  const recovery = useRecoveryDiscovery({ identity: actions.recoveryIdentity, enabled: actions.ready,
    version: `${actions.recoveryVersion}:${id ?? ''}`,
    // Creation requires its own form; this dialog may never recover only the link half.
    list: async () => (await actions.listRecoverable({ closedOnly: true })).filter(record => !record.creation).map(record => {
      const action = record.action;
      const targetId = action?.kind === 'assign' ? action.targetId : action?.kind === 'reorder' ? action.seriesId : null;
      const target = targetId ? record.pins.find(pin => pin.baseline.resource.id === targetId) : null;
      return { id: record.scopeId, title: String(target?.predecessor?.value?.title ?? target?.baseline.value?.title ?? t('navigation.series')),
        preview: t(action?.kind === 'reorder' ? 'workspaces.series.actions.reorder'
          : action?.kind === 'remove' ? 'workspaces.series.actions.removeFromSeries' : 'workspaces.series.membershipAssignment') };
    }),
    recover: async id => { setSelected({ identity: actions.recoveryIdentity, id }); } });
  return <>
    {!id && (recovery.choices.length > 0 || recovery.error) && <section className="mb-4 space-y-2 rounded-lg border border-amber-200 p-3 dark:border-amber-700">
      <h2 className="font-semibold">{t('workspaces.series.membershipRecovery')}</h2>
      <DataSyncStatus status={null} recoveryChoices={recovery.choices} recoveryLoading={recovery.loading}
        recoveryError={recovery.error} onListRecovery={recovery.refresh} onRecover={recovery.recover} />
    </section>}
    {id && <SeriesMembershipDialog key={id} mode="recover" recoveryId={id} seriesId="" onClose={() => setSelected(null)} />}
  </>;
}
