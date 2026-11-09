'use client';

import { useState } from 'react';

import { OutdatedTabNotice } from '@/components/common/OutdatedTabNotice';
import { useTranslation } from '@locales/useTranslation';

import { isSyncTrouble } from './status';

import type { useDataMembership } from './react.client';
import type { SeriesMembershipComparison } from './seriesMembershipHistory';

type Membership = Pick<ReturnType<typeof useDataMembership>, 'durable' | 'error' | 'phase' | 'delivery' | 'retry' | 'discard'>
  & Partial<Pick<ReturnType<typeof useDataMembership>, 'errorWords'>>;
const phaseKey = (action: Membership): string => {
  if (!action.durable) return action.error ? 'dataSync.phase.localFailure' : 'dataSync.phase.savingLocally';
  const phase = action.delivery?.phase ?? action.phase;
  if (phase === 'editing') return 'dataSync.phase.draft';
  if (phase === 'saving') return 'dataSync.phase.savingLocally';
  if (phase === 'acknowledged') return 'dataSync.phase.saved';
  if (phase === 'cancelled') return 'dataSync.actionCancelled';
  if (!phase || phase === 'unavailable' || phase === 'submitted') return 'dataSync.actionChecking';
  return `dataSync.phase.${phase}`;
};
/** The phase worth saying, or null while the action travels as expected (see `isSyncTrouble`). */
const troubleKey = (action: Membership): string | null => {
  const key = phaseKey(action);
  return key.startsWith('dataSync.phase.') && isSyncTrouble(key.slice('dataSync.phase.'.length)) ? key : null;
};

/** Presentation only: the engine decides whether replacing the action is safe. */
export function DataMembershipStatus({ action, onDiscarded, onReview, onKeep }: {
  action: Membership;
  onDiscarded?: () => void;
  onReview?: (compared: readonly SeriesMembershipComparison[]) => Promise<void>;
  onKeep?: (compared: readonly SeriesMembershipComparison[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await operation(); } catch { /* The owning hook retains and presents the error. */ }
    finally { setBusy(false); }
  };
  const words = action.errorWords;
  const changedStage = words && 'key' in words && words.key === 'dataSync.failure.membershipStageChanged';
  const trouble = action.phase && !changedStage ? troubleKey(action) : null;
  const compared = action.delivery?.comparisons;
  const exact = action.delivery?.canChooseExact && compared?.length && onKeep;
  if (!trouble && !action.error && !action.delivery?.canDiscard) return null;
  return <div className="space-y-2 text-sm">
    {trouble && <p role="status" aria-live="polite" className="text-gray-600 dark:text-gray-300">{t(trouble)}</p>}
    {action.error && <p role="alert" className="text-rose-700 dark:text-rose-300">{action.error}</p>}
    {/* A refusal on a tab older than the server: the way out is a reload (BUG-20261107-outdated-tab-refusal-unexplained). */}
    <OutdatedTabNotice refused={action.delivery?.phase === 'refused'} />
    {!changedStage && (action.error || (trouble && !['refused', 'conflict'].includes(action.delivery?.phase ?? ''))) &&
      <button type="button" disabled={busy} className="rounded-lg border px-3 py-1.5 disabled:opacity-50" onClick={() => { void run(action.retry); }}>{t('dataSync.retry')}</button>}
    {!!compared?.length && <section aria-label={t('workspaces.series.membershipHistory.comparisonHeading')} className="space-y-2">
      <p>{t('workspaces.series.membershipHistory.comparisonHeading')}</p>
      <ul className="space-y-2">{compared.map(({ ref, label, proposed, stored }) => <li key={ref.type + ':' + ref.refId}>
        <p className="font-medium break-words">{label || t('common.unknown')}</p>
        <p className="break-words">{t('workspaces.series.membershipHistory.proposed', { value: proposed ? proposed.label || t('common.unknown') : t('addSermon.noSeriesOption') })}</p>
        <p className="break-words">{t('workspaces.series.membershipHistory.stored', { value: stored ? stored.label || t('common.unknown') : t('addSermon.noSeriesOption') })}</p>
      </li>)}</ul>
    </section>}
    {action.delivery?.canDiscard && <div className="space-y-2">
      {!exact && <p>{t('dataSync.discardActionHint')}</p>}
      <div className="flex flex-wrap gap-2">
        {exact && onReview && <button type="button" disabled={busy} className="rounded-lg border px-3 py-1.5 disabled:opacity-50"
          onClick={() => { void run(() => onReview(compared)); }}>{t('workspaces.series.membershipHistory.review')}</button>}
        <button type="button" disabled={busy} className="rounded-lg border px-3 py-1.5 disabled:opacity-50"
          onClick={() => { void run(async () => {
            if (exact) await onKeep(compared);
            else await action.discard();
            onDiscarded?.();
          }); }}>
          {t(exact ? 'workspaces.series.membershipHistory.keep' : 'dataSync.discardAction')}
        </button>
      </div>
    </div>}
  </div>;
}
