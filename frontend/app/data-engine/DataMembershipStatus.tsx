'use client';

import { useState } from 'react';

import { OutdatedTabNotice } from '@/components/common/OutdatedTabNotice';
import { useTranslation } from '@locales/useTranslation';

import { isSyncTrouble } from './status';

import type { useDataMembership } from './react.client';

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
export function DataMembershipStatus({ action, onDiscarded }: { action: Membership; onDiscarded?: () => void }) {
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
  if (!trouble && !action.error && !action.delivery?.canDiscard) return null;
  return <div className="space-y-2 text-sm">
    {trouble && <p role="status" aria-live="polite" className="text-gray-600 dark:text-gray-300">{t(trouble)}</p>}
    {action.error && <p role="alert" className="text-rose-700 dark:text-rose-300">{action.error}</p>}
    {/* A refusal on a tab older than the server: the way out is a reload (BUG-20261107-outdated-tab-refusal-unexplained). */}
    <OutdatedTabNotice refused={action.delivery?.phase === 'refused'} />
    {!changedStage && (action.error || (trouble && !['refused', 'conflict'].includes(action.delivery?.phase ?? ''))) &&
      <button type="button" disabled={busy} className="rounded-lg border px-3 py-1.5 disabled:opacity-50" onClick={() => { void run(action.retry); }}>{t('dataSync.retry')}</button>}
    {action.delivery?.canDiscard && <div className="space-y-2">
      <p>{t('dataSync.discardActionHint')}</p>
      <button type="button" disabled={busy} className="rounded-lg border px-3 py-1.5 disabled:opacity-50"
        onClick={() => { void run(async () => { await action.discard(); onDiscarded?.(); }); }}>{t('dataSync.discardAction')}</button>
    </div>}
  </div>;
}
