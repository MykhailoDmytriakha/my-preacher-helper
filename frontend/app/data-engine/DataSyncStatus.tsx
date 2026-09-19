'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SaveConflictBanner } from '@/components/SaveConflictBanner';

import type { SyncStatus } from './status';

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
  recoveryChoices?: readonly RecoveryChoice[];
  onListRecovery?: () => void | Promise<void>;
  onRecover?: (id: string) => void | Promise<void>;
  recoveryLoading?: boolean;
  recoveryError?: string | null;
  className?: string;
}

/** Present the engine's decisions; conflict detection and merge policy stay in the engine. */
export function DataSyncStatus({ status, error, onKeepLocal, onAcceptRemote, onRetry, recoveryChoices = [], onListRecovery, onRecover, recoveryLoading = false, recoveryError, className = '' }: DataSyncStatusProps) {
  const { t } = useTranslation();
  const scope = useMemo(() => ({ onKeepLocal, onAcceptRemote, onRetry, onListRecovery, onRecover }), [onKeepLocal, onAcceptRemote, onRetry, onListRecovery, onRecover]);
  const currentScope = useRef<object>(scope); currentScope.current = scope;
  useEffect(() => { currentScope.current = scope; return () => { currentScope.current = {}; }; }, [scope]);
  const [action, setAction] = useState<{ scope: object; busy: boolean; error: string | null } | null>(null);
  const running = useRef<object | null>(null);
  const [selectedId, setSelectedId] = useState('');
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
  if (!status && !failure && !onListRecovery && !recoveryChoices.length && !recoveryError) return null;
  const buttonClass = 'rounded-lg border border-current px-3 py-1.5 text-sm disabled:opacity-50';
  return <div className={`space-y-3 text-sm ${className}`}>
    {conflictBanner ? <SaveConflictBanner onKeepMine={() => run(keep)} onTakeTheirs={() => run(accept)} busy={busy} /> : status && <div role="status" aria-live="polite" className="text-gray-600 dark:text-gray-300">
      <p>{t(status.phase === 'saved' && recoveryChoices.length ? 'dataSync.unfinishedWork' : `dataSync.phase.${status.phase}`)}</p>
      {status.freshness !== 'server' && <p className="mt-1 text-xs">{t(`dataSync.freshness.${status.freshness}`)}</p>}
      {status.checking && <p className="mt-1 text-xs">{t('dataSync.checking')}</p>}
      {status.readFailed && <p className="mt-1 text-xs">{t('dataSync.readFailed')}</p>}
    </div>}
    {failure && <p role="alert" className="text-rose-700 dark:text-rose-300">{failure}</p>}
    <div className="flex flex-wrap gap-2">
      {!conflictBanner && keep && <button type="button" className={buttonClass} disabled={busy} onClick={() => run(keep)}>{t('dataSync.keepLocal')}</button>}
      {!conflictBanner && accept && <button type="button" className={buttonClass} disabled={busy} onClick={() => run(accept)}>{t('dataSync.acceptRemote')}</button>}
      {onRetry && (failure || status?.readFailed || (status && status.phase !== 'saved')) && <button type="button" className={buttonClass} disabled={busy} onClick={() => run(onRetry)}>{t('dataSync.retry')}</button>}
      {onListRecovery && <button type="button" className={buttonClass} disabled={busy || recoveryLoading} onClick={() => run(onListRecovery)}>{t(recoveryLoading ? 'dataSync.recoveryLoading' : 'dataSync.findRecovery')}</button>}
    </div>
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
