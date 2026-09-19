'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import FormDialog from '@/components/ui/FormDialog';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useGroupDataDocument } from '@/hooks/useGroupDataDocument';

/** The delete confirmation opens the same protected document editor as the detail screen. */
export function EngineDeleteGroupModal({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const data = useGroupDataDocument(groupId);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (busy || data.loading) return;
    setBusy(true);
    try { await data.deleteGroupDetail(); onClose(); }
    catch { setBusy(false); }
  };
  return <FormDialog title={t('workspaces.groups.actions.deleteConfirmTitle')} onClose={onClose} tone="emerald">
    <div className="space-y-4">
      <p>{t('workspaces.groups.actions.deleteConfirm')} {data.group?.title}</p>
      <DataSyncStatus status={data.status} error={data.error} onRetry={data.refresh}
        onAcceptRemote={data.acceptRemote} onKeepLocal={data.keepLocal} />
      <button type="button" disabled={busy || data.loading || !data.status?.canRemove}
        className="rounded-lg bg-red-600 px-4 py-2 text-white disabled:opacity-50" onClick={() => { void remove(); }}>
        {t('workspaces.groups.actions.delete')}
      </button>
    </div>
  </FormDialog>;
}
