'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SaveConflictBanner } from '@/components/SaveConflictBanner';

import { isSyncTrouble } from './status';
import { useLasting } from './useLasting';

import type { SyncStatus } from './status';

export { STATUS_SETTLE_MS } from './useLasting';

export interface RecoveryChoice {
  id: string;
  title: string;
  preview?: string;
}
export interface DataSyncStatusProps {
  status: SyncStatus | null;
  error?: string | null;
  onKeepLocal?: () => void | Promise<void>;
  onAcceptRemote?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  /** Drafts found by `useRecoveryDiscovery`, which looks by itself; nothing to ask for. */
  recoveryChoices?: readonly RecoveryChoice[];
  onRecover?: (id: string) => void | Promise<void>;
  recoveryLoading?: boolean;
  recoveryError?: string | null;
  className?: string;
}


/** Present the engine's decisions; conflict detection and merge policy stay in the engine. */
export function DataSyncStatus({ status, error, onKeepLocal, onAcceptRemote, onRetry, recoveryChoices = [], onRecover, recoveryLoading = false, recoveryError, className = '' }: DataSyncStatusProps) {
  const { t } = useTranslation();
  const scope = useMemo(() => ({ onKeepLocal, onAcceptRemote, onRetry, onRecover }), [onKeepLocal, onAcceptRemote, onRetry, onRecover]);
  const currentScope = useRef<object>(scope); currentScope.current = scope;
  useEffect(() => { currentScope.current = scope; return () => { currentScope.current = {}; }; }, [scope]);
  const [action, setAction] = useState<{ scope: object; busy: boolean; error: string | null } | null>(null);
  const running = useRef<object | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const unconfirmedCopy = useLasting(Boolean(status && status.freshness !== 'server'));
  const readTrouble = useLasting(Boolean(status?.readFailed));
  const selected = recoveryChoices.find(choice => choice.id === selectedId);
  const busy = action?.scope === scope && action.busy;
  const failure = error ?? (action?.scope === scope ? action.error : null);
  const run = (callback: () => void | Promise<void>) => {
    if (running.current === scope) return;
    running.current = scope;
    setAction({ scope, busy: true, error: null });
    void Promise.resolve().then(() => { if (currentScope.current === scope) return callback(); }).then(() => {
      if (currentScope.current === scope) setAction({ scope, busy: false, error: null });
    }, caught => {
      if (currentScope.current === scope) setAction({ scope, busy: false, error: caught instanceof Error ? caught.message : t('dataSync.actionFailed') });
    }).finally(() => { if (running.current === scope) running.current = null; });
  };
  const keep = status?.canKeepLocal && onKeepLocal;
  const accept = status?.canAcceptRemote && onAcceptRemote;
  const conflictBanner = status?.phase === 'conflict' && keep && accept;
  // An unconfirmed copy is the app still checking; it is said only beside a check that failed.
  const showFreshness = unconfirmedCopy && readTrouble && status?.freshness !== 'server';
  const trouble = isSyncTrouble(status?.phase);
  // Unfinished drafts from earlier sessions are a choice for the person, so they are announced.
  const showPhase = Boolean(status) && (trouble || recoveryChoices.length > 0);
  const showRetry = Boolean(onRetry && (failure || readTrouble || trouble));
  const said = [showPhase, showFreshness, readTrouble, failure, recoveryChoices.length, recoveryError, keep, accept, showRetry];
  if (!said.some(Boolean)) return null;
  const buttonClass = 'rounded-lg border border-current px-3 py-1.5 text-sm disabled:opacity-50';
  return <div className={`space-y-3 text-sm ${className}`}>
    {conflictBanner ? <SaveConflictBanner onKeepMine={() => run(keep)} onTakeTheirs={() => run(accept)} busy={busy} /> : status && (showPhase || showFreshness || readTrouble) && <div role="status" aria-live="polite" className="text-gray-600 dark:text-gray-300">
      {showPhase && <p>{t(trouble ? `dataSync.phase.${status.phase}` : 'dataSync.unfinishedWork')}</p>}
      {showFreshness && <p className="mt-1 text-xs">{t(`dataSync.freshness.${status.freshness}`)}</p>}
      {readTrouble && <p className="mt-1 text-xs">{t('dataSync.readFailed')}</p>}
    </div>}
    {failure && <p role="alert" className="text-rose-700 dark:text-rose-300">{failure}</p>}
    {((!conflictBanner && (keep || accept)) || showRetry) && <div className="flex flex-wrap gap-2">
      {!conflictBanner && keep && <button type="button" className={buttonClass} disabled={busy} onClick={() => run(keep)}>{t('dataSync.keepLocal')}</button>}
      {!conflictBanner && accept && <button type="button" className={buttonClass} disabled={busy} onClick={() => run(accept)}>{t('dataSync.acceptRemote')}</button>}
      {showRetry && onRetry && <button type="button" className={buttonClass} disabled={busy} onClick={() => run(onRetry)}>{t('dataSync.retry')}</button>}
    </div>}
    {recoveryError && <p role="alert" className="text-rose-700 dark:text-rose-300">{recoveryError}</p>}
    {recoveryChoices.length > 0 && <div className="space-y-2 rounded-lg border border-gray-300 p-3 dark:border-gray-600">
      <label className="block"><span>{t('dataSync.recoveryLabel')}</span>
        <select className="mt-1 block w-full rounded border border-gray-300 bg-transparent px-2 py-1 dark:border-gray-600" value={selected?.id ?? ''} disabled={busy || recoveryLoading} onChange={event => setSelectedId(event.target.value)}>
          <option value="">{t('dataSync.chooseRecovery')}</option>
          {recoveryChoices.map(choice => <option key={choice.id} value={choice.id}>{choice.title}</option>)}
        </select>
      </label>
      {selected?.preview && <p className="max-h-24 overflow-auto whitespace-pre-wrap break-words text-gray-600 dark:text-gray-300">{selected.preview}</p>}
      <p className="text-xs text-gray-500 dark:text-gray-400">{t('dataSync.recoveryHint')}</p>
      {onRecover && <button type="button" className={buttonClass} disabled={!selected || busy || recoveryLoading} onClick={() => { if (selected) run(() => onRecover(selected.id)); }}>{t('dataSync.recover')}</button>}
    </div>}
  </div>;
}
