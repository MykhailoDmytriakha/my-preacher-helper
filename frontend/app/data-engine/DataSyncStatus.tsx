'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import { refusalWords, sayFailure, type FailureWords } from '@/utils/actionFailureMessage';
import { recordDiagnostic } from '@/utils/appDiagnostics';

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
  /**
   * What this status speaks about: the hook's `recoveryIdentity`, or any value that changes exactly
   * when the block starts speaking about something else. Screens pass fresh callbacks on every
   * render, so the callbacks cannot tell a re-render from a switch; the subject does
   * (BUG-20261003-sync-actions-unlock-on-rerender).
   */
  subject: unknown;
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
  /** Names what this status is about when it stands apart from its screen (e.g. the settings). */
  title?: string;
  className?: string;
}


/** No subject is ever this: the block was taken off the screen. */
const GONE = Symbol('gone');

/** Present the engine's decisions; conflict detection and merge policy stay in the engine. */
export function DataSyncStatus({ subject, status, error, onKeepLocal, onAcceptRemote, onRetry, recoveryChoices = [], onRecover, recoveryLoading = false, recoveryError, title, className = '' }: DataSyncStatusProps) {
  const { t } = useTranslation();
  // The subject shown on screen now; set at commit, so a render React throws away never moves it.
  const currentSubject = useRef<unknown>(subject);
  useLayoutEffect(() => { currentSubject.current = subject; return () => { currentSubject.current = GONE; }; }, [subject]);
  // Subjects with an action under way: the ref guards a second click in the same moment, the state
  // draws the lock. Per subject, so switching away and back while one hangs keeps it locked.
  const runningFor = useRef(new Set<unknown>());
  const [busyFor, setBusyFor] = useState<ReadonlySet<unknown>>(() => new Set());
  const [failed, setFailed] = useState<{ subject: unknown; words: FailureWords } | null>(null);
  // The block's own words are a fallback for an action whose owner said nothing about its failure.
  // Once the owner's `error` changes — it said the failure, or a retry elsewhere ended it — the
  // fallback is over; reset in render, so the old words never stand for a frame.
  const [ownerSaid, setOwnerSaid] = useState(error);
  if (ownerSaid !== error) {
    setOwnerSaid(error);
    if (failed) setFailed(null);
  }
  const [selectedId, setSelectedId] = useState('');
  const unconfirmedCopy = useLasting(Boolean(status && status.freshness !== 'server'));
  const readTrouble = useLasting(Boolean(status?.readFailed));
  const selected = recoveryChoices.find(choice => choice.id === selectedId);
  const busy = busyFor.has(subject);
  // `error` arrives already in words: the engine hooks translate where they catch
  // (BUG-20261003-engine-error-sentence-on-screen); a failed choice here is said the same way.
  const failure = error ?? (failed && failed.subject === subject ? sayFailure(failed.words, t) : null);
  const run = (callback: () => void | Promise<void>) => {
    if (runningFor.current.has(subject)) return;
    runningFor.current.add(subject);
    setBusyFor(new Set(runningFor.current));
    setFailed(now => (now?.subject === subject ? null : now));
    // The click runs the callback the person saw, even when the screen re-renders before it starts;
    // a stale one refuses inside the callback. A late failure of a subject no longer shown stays quiet.
    void Promise.resolve().then(callback).then(() => undefined, caught => {
      if (currentSubject.current === subject) setFailed({ subject, words: refusalWords(caught, 'dataSync.actionFailed') });
    }).finally(() => {
      runningFor.current.delete(subject);
      setBusyFor(new Set(runningFor.current));
    });
  };
  const keep = status?.canKeepLocal && onKeepLocal;
  // "Keep mine" sends what the surrounding form holds, so it asks the form's own checks first, as its
  // Save does — a day typed that is not in the calendar is not sent this way either
  // (BUG-20261003-date-form-accepts-impossible-day). A form that checks itself (`noValidate`) is left to it.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const keepChecked = (callback: () => void | Promise<void>) => {
    const form = rootRef.current?.closest('form');
    if (form && !form.noValidate && !form.reportValidity()) return;
    run(callback);
  };
  const accept = status?.canAcceptRemote && onAcceptRemote;
  const conflictBanner = status?.phase === 'conflict' && keep && accept;
  // An unconfirmed copy is the app still checking; it is said only beside a check that failed.
  const showFreshness = unconfirmedCopy && readTrouble && status?.freshness !== 'server';
  const trouble = isSyncTrouble(status?.phase);
  const troublePhase = trouble ? status?.phase : null;
  // What the person was shown goes into the technical report's path (owner, 2026-10-10).
  useEffect(() => { if (troublePhase) recordDiagnostic('sync-trouble', { code: troublePhase }); }, [troublePhase]);
  // Unfinished drafts from earlier sessions are a choice for the person, so they are announced.
  const showPhase = Boolean(status) && (trouble || recoveryChoices.length > 0);
  const showRetry = Boolean(onRetry && (failure || readTrouble || trouble));
  const said = [showPhase, showFreshness, readTrouble, failure, recoveryChoices.length, recoveryError, keep, accept, showRetry];
  if (!said.some(Boolean)) return null;
  const buttonClass = 'rounded-lg border border-current px-3 py-1.5 text-sm disabled:opacity-50';
  return <div ref={rootRef} className={`space-y-3 text-sm ${className}`} {...(title ? { role: 'region', 'aria-label': title } : {})}>
    {title && <p className="font-medium">{title}</p>}
    {conflictBanner ? <SaveConflictBanner onKeepMine={() => keepChecked(keep)} onTakeTheirs={() => run(accept)} busy={busy} /> : status && (showPhase || showFreshness || readTrouble) && <div role="status" aria-live="polite" className="text-gray-600 dark:text-gray-300">
      {showPhase && <p>{t(trouble ? `dataSync.phase.${status.phase}` : 'dataSync.unfinishedWork')}</p>}
      {showFreshness && <p className="mt-1 text-xs">{t(`dataSync.freshness.${status.freshness}`)}</p>}
      {readTrouble && <p className="mt-1 text-xs">{t('dataSync.readFailed')}</p>}
    </div>}
    {failure && <p role="alert" className="text-rose-700 dark:text-rose-300">{failure}</p>}
    {((!conflictBanner && (keep || accept)) || showRetry) && <div className="flex flex-wrap gap-2">
      {!conflictBanner && keep && <button type="button" className={buttonClass} disabled={busy} onClick={() => keepChecked(keep)}>{t('dataSync.keepLocal')}</button>}
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
