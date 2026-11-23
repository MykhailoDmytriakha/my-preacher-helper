'use client';

import { useState } from 'react';

import { DataSyncStatus, FieldComparison } from '@/data-engine/DataSyncStatus';
import { useClipboard } from '@/hooks/useClipboard';
import { useTranslation } from '@locales/useTranslation';

import type { useServiceOrderInputDraft } from '@/hooks/useServiceOrderInputDraft';

const labels = { orderTitle: 'orderTitle', title: 'stepTitle', body: 'stepWords', scriptureRefs: 'refs' } as const;

function CopyRetainedInput({ text, className }: { text: string; className: string }) {
  const { t } = useTranslation();
  const { copyToClipboard, isCopied, error } = useClipboard();
  return <>
    <button type="button" className={className} onClick={() => { void copyToClipboard(text); }}>{t('serviceOrders.copyRecoveredField')}</button>
    {(isCopied || error) && <span role="status" className="ml-2 text-sm">{t(isCopied ? 'serviceOrders.recoveredFieldCopied' : 'serviceOrders.recoveredFieldCopyFailed')}</span>}
  </>;
}

export function ServiceOrderDraftRecovery({ draft, editing }: { draft: ReturnType<typeof useServiceOrderInputDraft>; editing: boolean }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const { recovery } = draft;
  const single = recovery.choices.length === 1 ? recovery.choices[0].id : undefined;
  const run = (action: () => Promise<void>) => {
    setBusy(true);
    void action().catch(() => undefined).finally(() => setBusy(false));
  };
  const button = 'rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50';
  const copyOnly = draft.recoveredFields.length > 0 && draft.recoveredFields.every(field => !field.available)
    && draft.inputs.every(input => input.retainedOnly);
  return <>
    <DataSyncStatus subject={draft.subject} status={draft.status}
      error={copyOnly ? null : draft.error} errorWords={copyOnly ? undefined : draft.errorWords}
      recoveryChoices={editing ? [] : recovery.choices} reviewRecoveryId={editing ? undefined : single}
      recoveryLoading={!editing && recovery.loading} recoveryError={editing ? undefined : recovery.error}
      onRecover={editing ? undefined : recovery.recover} onDiscardRecovery={editing ? undefined : recovery.discard}
      onRetry={!copyOnly && (draft.error || draft.restored) ? draft.refresh : undefined} className="mt-4" />
    {draft.recoveredFields.length > 0 && <section className="mt-4 space-y-3" aria-label={t('dataSync.reviewSavedChange')}>
      {draft.recoveredFields.map(({ key, input, stored, mine, available, mayApply, mayUseLocal, choose }) => <div key={key} className="space-y-2">
        <FieldComparison comparison={{ valueKind: 'field', title: t(`serviceOrders.${labels[input.field]}`), mine: mine || t('dataSync.emptyField'),
          stored: available ? stored || t('dataSync.emptyField') : t('serviceOrders.recoveredFieldUnavailable') }} />
        {!available && mine && <CopyRetainedInput text={mine} className={button} />}
        {mayApply && <button type="button" className={button} disabled={busy}
          onClick={() => run(() => draft.save(input))}>{t('serviceOrders.applyRecoveredField')}</button>}
        {choose && <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={busy || !mayUseLocal}
            onClick={() => run(choose.local)}>{t('dataSync.useLocalVersion')}</button>
          <button type="button" className={button} disabled={busy}
            onClick={() => run(choose.stored)}>{t('dataSync.useStoredVersion')}</button>
        </div>}
      </div>)}
    </section>}
  </>;
}
