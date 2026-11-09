'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';


import { OutdatedTabNotice } from '@/components/common/OutdatedTabNotice';
import { useRecordReadSummary } from '@/components/common/recordReadSummary';
import { SyncNotice } from '@/components/common/SyncNoticeDock';
import { useSyncOutlet } from '@/components/common/syncOutlet';
import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import { useConfirm, useDiscardQuestion, type DiscardQuestionKey } from '@/hooks/useConfirm';
import { useFailureNotice } from '@/hooks/useFailureNotice';
import { useLasting } from '@/hooks/useLasting';
import { useServerUnavailableNotice } from '@/hooks/useServerUnavailableNotice';
import { refusalWords, sayFailure, type FailureWords } from '@/utils/actionFailureMessage';
import { recordDiagnostic } from '@/utils/appDiagnostics';
import { useTranslation } from '@locales/useTranslation';

import { isSyncTrouble } from './status';

import type { SyncStatus } from './status';

export { SyncOutlet } from '@/components/common/syncOutlet';

export { STATUS_SETTLE_MS } from '@/hooks/useLasting';

export interface RecoveryChoice {
  id: string;
  title: string;
  preview?: string;
  /** Closes over the exact listed copy; only its engine owns removal authority. */
  discard?: () => Promise<void>;
}
export interface TextComparison {
  identity?: string;
  mine: string;
  stored: string;
  title?: string;
  description?: string;
  valueKind?: 'field' | 'removed-row';
  scopedChoice?: true;
  keepMineDisabled?: boolean;
  actions?: { local: string; stored: string; confirmStored?: DiscardQuestionKey };
}
export interface DataSyncStatusProps {
  comparison?: TextComparison;
  conflictCopy?: Pick<TextComparison, 'identity' | 'description' | 'actions'>;
  /**
   * What this status speaks about: the hook's `recoveryIdentity`, or any value that changes exactly
   * when the block starts speaking about something else. Screens pass fresh callbacks on every
   * render, so the callbacks cannot tell a re-render from a switch; the subject does
   * (BUG-20261003-sync-actions-unlock-on-rerender).
   */
  subject: unknown;
  status: SyncStatus | null;
  error?: string | null;
  /** Words from the same failure as `error`; the data-read fact stays with the caller. */
  errorWords?: FailureWords;
  onKeepLocal?: () => void | Promise<void>;
  onAcceptRemote?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  /** Drafts found by `useRecoveryDiscovery`, which looks by itself; nothing to ask for. */
  recoveryChoices?: readonly RecoveryChoice[];
  /** A caller can identify the one listed copy that owns the displayed conflict. */
  reviewRecoveryId?: string;
  onRecover?: (id: string) => void | Promise<void>;
  onDiscardRecovery?: (action: () => Promise<void>) => Promise<void>;
  recoveryLoading?: boolean;
  recoveryError?: string | null;
  /** Names what this status is about when it stands apart from its screen (e.g. the settings). */
  title?: string;
  /** A real status in the workspace’s shared save-notice disclosure. */
  workspaceNotice?: boolean;
  className?: string;
}


export function FieldComparison({ comparison }: { comparison: TextComparison }) {
  const { t } = useTranslation();
  const localLabel = comparison.valueKind ? 'yourVersion' : 'yourFieldVersion';
  const storedLabel = comparison.valueKind ? 'storedVersion' : 'storedFieldVersion';
  return <div className="space-y-2 rounded-md border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-800 dark:bg-rose-950/20">
    {comparison.title && <p className="font-medium">{comparison.title}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      {([[localLabel, comparison.mine], [storedLabel, comparison.stored]] as const).map(([key, value]) =>
        <div key={key} className="min-w-0"><p className="mb-1 font-medium">{t(`dataSync.${key}`)}</p>
          <p tabIndex={0} aria-label={t(`dataSync.${key}`)} className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words">{value}</p>
        </div>)}
    </div>
  </div>;
}

/** No subject is ever this: the block was taken off the screen. */
const GONE = Symbol('gone');

/** Present the engine's decisions; conflict detection and merge policy stay in the engine. */
export function DataSyncStatus({ subject, status, error, errorWords, onKeepLocal, onAcceptRemote, onRetry, recoveryChoices = [], reviewRecoveryId, onRecover, onDiscardRecovery, recoveryLoading = false, recoveryError, title, comparison, conflictCopy, workspaceNotice = false, className = '' }: DataSyncStatusProps) {
  const { t } = useTranslation();
  const outlet = useSyncOutlet(subject);
  const sayNotice = useFailureNotice();
  const { askBeforeDiscard, discardDialog, withdraw } = useDiscardQuestion('text');
  const conflictPresentation = comparison ?? conflictCopy;
  const comparisonIdentity = conflictPresentation?.identity;
  const currentComparison = useRef(comparisonIdentity);
  useLayoutEffect(() => {
    currentComparison.current = comparisonIdentity;
    return withdraw;
  }, [comparisonIdentity, withdraw]);
  const { confirm: confirmDelete, confirmDialog: deleteDialog, withdraw: withdrawDelete } = useConfirm();
  const deleting = Boolean(status?.deleting && status.canKeepLocal);
  const deletionAllowed = deleting && Boolean(onKeepLocal);
  const currentDeletion = useRef(deletionAllowed);
  // The subject shown on screen now; set at commit, so a render React throws away never moves it.
  const currentSubject = useRef<unknown>(subject);
  useLayoutEffect(() => {
    currentSubject.current = subject;
    currentDeletion.current = deletionAllowed;
    return () => { currentSubject.current = GONE; currentDeletion.current = false; withdraw(); withdrawDelete(); };
  }, [subject, deletionAllowed, withdraw, withdrawDelete]);
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
  // While the server says it cannot give the person's data, the app-wide line says so and what
  // becomes of the changes (`OfflineBanner`); a block does not repeat it in its own words — a failed
  // check, an unconfirmed copy, a delivery still unanswered — nor offers a Retry that can only be
  // refused again (BUG-20261019-outage-said-as-two-check-lines). Choices and refusals still speak.
  const serverNoticeShown = useServerUnavailableNotice();
  const recordReadSummary = useRecordReadSummary();
  const claimedRead = Boolean(recordReadSummary && (recordReadSummary.subject === subject
    || recordReadSummary.relatedSubjects?.includes(subject)
    || (errorWords && recordReadSummary.words === errorWords)));
  const unconfirmedCopy = useLasting(Boolean(status && status.freshness !== 'server')) && !serverNoticeShown;
  const readTrouble = useLasting(Boolean(status?.readFailed)) && !serverNoticeShown && !claimedRead;
  const review = recoveryChoices.length === 1 && recoveryChoices[0].id === reviewRecoveryId ? recoveryChoices[0] : undefined;
  const selected = review ?? recoveryChoices.find(choice => choice.id === selectedId);
  const selectedCopy = useRef(selected);
  useLayoutEffect(() => {
    selectedCopy.current = selected;
    return withdraw;
  }, [selected, withdraw]);
  const busy = busyFor.has(subject);
  // `error` arrives already in words: the engine hooks translate where they catch
  // (BUG-20261003-engine-error-sentence-on-screen); a failed choice here is said the same way.
  const ownerFailure = claimedRead && errorWords && 'key' in errorWords && errorWords.readNotice
    ? null : sayNotice(errorWords, error ?? null);
  const failure = ownerFailure ?? (failed && failed.subject === subject ? sayFailure(failed.words, t) : null);
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
    run(() => {
      if (currentSubject.current === subject && currentComparison.current === comparisonIdentity) return callback();
    });
  };
  const accept = status?.canAcceptRemote && onAcceptRemote;
  const chooseStored = (callback: () => void | Promise<void>) => askBeforeDiscard(true, callback,
    () => currentSubject.current === subject && currentComparison.current === comparisonIdentity,
    conflictPresentation?.actions?.confirmStored ?? (comparison?.scopedChoice ? 'dataSync.confirmStoredField' : comparison?.valueKind === 'removed-row' ? 'common.discardChanges' : undefined));
  const conflictBanner = !deleting && status?.phase === 'conflict' && keep && accept;
  const repeatDeletion = () => {
    if (!keep) return;
    keepChecked(async () => {
      const accepted = await confirmDelete({ title: { key: 'common.deleteItem.title' },
        description: { key: 'common.deleteItem.description' }, confirmText: { key: 'common.delete' }, cancelText: { key: 'common.cancel' } });
      if (accepted && currentSubject.current === subject && currentDeletion.current) await keep();
    });
  };
  // An unconfirmed copy is the app still checking; it is said only beside a check that failed.
  const showFreshness = unconfirmedCopy && readTrouble && status?.freshness !== 'server';
  const trouble = isSyncTrouble(status?.phase) && !(serverNoticeShown && status?.phase === 'unknown');
  const troublePhase = trouble ? status?.phase : null;
  // What the person was shown goes into the technical report's path (owner, 2026-10-10).
  useEffect(() => { if (troublePhase) recordDiagnostic('sync-trouble', { code: troublePhase }); }, [troublePhase]);
  // Unfinished drafts from earlier sessions are a choice for the person, so they are announced.
  const pendingDeletion = Boolean(status?.deleting && !trouble);
  const showPhase = Boolean(status) && (trouble || recoveryChoices.length > 0);
  const showRetry = Boolean(onRetry && (failure || readTrouble || (trouble && !(comparison && conflictBanner))));
  const said = [pendingDeletion, showPhase, showFreshness, readTrouble, failure, recoveryChoices.length, recoveryError, keep, accept, showRetry];
  if (!said.some(Boolean)) return <>{discardDialog}{deleteDialog}</>;
  const buttonClass = 'rounded-lg border border-current px-3 py-1.5 text-sm disabled:opacity-50';
  const content = <>
  <div ref={rootRef} className={`space-y-3 text-sm ${className}`} {...(comparison ? { role: 'region', 'aria-label': t('dataSync.versionComparison') } : title ? { role: 'region', 'aria-label': title } : {})}>
    {title && <p className="font-medium">{title}</p>}
    {comparison && <FieldComparison comparison={comparison} />}
    {conflictBanner ? <SaveConflictBanner description={conflictPresentation?.description ?? (comparison ? t('dataSync.fieldVersionChanged') : undefined)}
      keepMineLabel={conflictPresentation?.actions?.local ?? (comparison?.valueKind ? t(comparison.valueKind === 'removed-row' ? 'dataSync.keepDraft' : 'dataSync.useLocalVersion') : undefined)}
      keepMineDisabled={comparison?.keepMineDisabled}
      takeTheirsLabel={conflictPresentation?.actions?.stored ?? (comparison ? t('dataSync.useStoredVersion') : undefined)} onKeepMine={() => keepChecked(keep)} onTakeTheirs={() => run(() => chooseStored(accept))} busy={busy} /> : status && (pendingDeletion || showPhase || showFreshness || readTrouble) && <div role="status" aria-live="polite" className="text-gray-600 dark:text-gray-300">
      {pendingDeletion && <p>{t('recordAvailability.deleting')}</p>}
      {showPhase && !pendingDeletion && <p>{t(deleting ? (status.phase === 'refused' ? 'dataSync.deleteRefusedTitle' : 'dataSync.deleteConflictTitle') : trouble ? `dataSync.phase.${status.phase}` : 'dataSync.unfinishedWork')}</p>}
      {showPhase && deleting && <p>{t(status.phase === 'refused' ? 'dataSync.deleteRefusedBody' : 'dataSync.deleteConflictBody')}</p>}
      {showFreshness && <p className="mt-1 text-xs">{t(`dataSync.freshness.${status.freshness}`)}</p>}
      {readTrouble && <p className="mt-1 text-xs">{t('dataSync.readFailed')}</p>}
    </div>}
    {/* A refusal on a tab older than the server: the way out is a reload (BUG-20261107-outdated-tab-refusal-unexplained). */}
    <OutdatedTabNotice refused={status?.phase === 'refused'} />
    {failure && <p role="alert" className="text-rose-700 dark:text-rose-300">{failure}</p>}
    {((!conflictBanner && (keep || accept)) || showRetry) && <div className="flex flex-wrap gap-2">
      {!conflictBanner && keep && <button type="button" className={buttonClass} disabled={busy} onClick={deleting ? repeatDeletion : () => keepChecked(keep)}>{t(deleting ? (status?.phase === 'refused' ? 'dataSync.retryDelete' : 'dataSync.deleteAnyway') : 'dataSync.keepLocal')}</button>}
      {!conflictBanner && accept && <button type="button" className={buttonClass} disabled={busy} onClick={() => run(deleting ? accept : () => chooseStored(accept))}>{t(deleting ? 'dataSync.keepRecord' : 'dataSync.acceptRemote')}</button>}
      {showRetry && onRetry && <button type="button" className={buttonClass} disabled={busy} onClick={() => run(onRetry)}>{t('dataSync.retry')}</button>}
    </div>}
    {recoveryError && <p role="alert" className="text-rose-700 dark:text-rose-300">{recoveryError}</p>}
    {recoveryChoices.length > 0 && <div className="space-y-2 rounded-lg border border-gray-300 p-3 dark:border-gray-600">
      {!review && <label className="block"><span>{t('dataSync.recoveryLabel')}</span>
        <select className="mt-1 block w-full rounded border border-gray-300 bg-transparent px-2 py-1 dark:border-gray-600" value={selected?.id ?? ''} disabled={busy || recoveryLoading} onChange={event => setSelectedId(event.target.value)}>
          <option value="">{t('dataSync.chooseRecovery')}</option>
          {recoveryChoices.map(choice => <option key={choice.id} value={choice.id}>{choice.title}</option>)}
        </select>
      </label>}
      {selected?.preview && <p className="max-h-24 overflow-auto whitespace-pre-wrap break-words text-gray-600 dark:text-gray-300">{selected.preview}</p>}
      <p className="text-xs text-gray-500 dark:text-gray-400">{t('dataSync.recoveryHint')}</p>
      <div className="flex flex-wrap gap-2">
        {onRecover && <button type="button" className={buttonClass} disabled={!selected || busy || recoveryLoading} onClick={() => { if (selected) run(() => onRecover(selected.id)); }}>{t(review ? 'dataSync.reviewSavedChange' : 'dataSync.recover')}</button>}
        {selected?.discard && onDiscardRecovery && <button type="button" className={buttonClass} disabled={busy || recoveryLoading}
          onClick={() => run(() => askBeforeDiscard(true, () => onDiscardRecovery(selected.discard!),
            () => currentSubject.current === subject && selectedCopy.current === selected))}>{t('dataSync.discardRecovery')}</button>}
      </div>
    </div>}
  </div>
  {discardDialog}{deleteDialog}
  </>;
  const shown = workspaceNotice ? <SyncNotice>{content}</SyncNotice> : content;
  return outlet ? createPortal(shown, outlet) : shown;
}
