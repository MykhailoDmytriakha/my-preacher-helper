'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import { isCollectionOnEngine, useDataEngine, useDocumentActions, waitsForDecision } from '@/data-engine/react.client';
import { useClipboard } from '@/hooks/useClipboard';

import type { DocumentData, ResourceRef } from '@/data-engine/types';

/**
 * Collections whose screens write through one-shot engine actions (useDocumentActions) and so
 * have no open editor to show a late answer. Councils, groups, series and sermons resolve in
 * their own pinned editors and are deliberately not listed here.
 */
const ONE_SHOT_COLLECTIONS = ['prayerRequests', 'serviceOrders', 'studyNotes', 'tags', 'planTemplates'];
const TEXT_FIELDS = ['title', 'name', 'description', 'content', 'answerText', 'summary'];

/** conflict: another device changed the same field · refused: the server will not take it · deleted: it changed after this device deleted it. */
type Kind = 'conflict' | 'refused' | 'deleted';
interface Waiting { resource: ResourceRef; kind: Kind; mine: string; theirs: string }

/** The words a version holds, so a choice is made looking at them. */
function textOf(value: DocumentData | null | undefined): string {
  if (!value) return '';
  return TEXT_FIELDS.map(field => value[field]).filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').join(' · ');
}

const sameResource = (a: ResourceRef, b: ResourceRef) => a.collection === b.collection && a.id === b.id;

/**
 * AN ANSWER THE SERVER GAVE AFTER THIS DEVICE KEPT THE CHANGE, FOR A DOCUMENT NO SCREEN HAS OPEN.
 *
 * A one-shot action is accepted once the engine holds it on this device. When the server then
 * answers with a conflict or a refusal, the list shows the stored version while this device's
 * words wait in closed checkpoints — and every later save of that document waits behind them.
 * This banner is that door, app-wide like the legacy OutboxConflictBanner. It speaks once per
 * DOCUMENT, with the newest text this device holds (the chain tip), and settles the whole chain
 * through useDocumentActions().resolve.
 */
export function EngineConflictBanner({ pollMs = 5_000 }: { pollMs?: number }) {
  return ONE_SHOT_COLLECTIONS.some(isCollectionOnEngine) ? <EngineConflicts pollMs={pollMs} /> : null;
}

function EngineConflicts({ pollMs }: { pollMs: number }) {
  const { t } = useTranslation();
  const { browser, owner } = useDataEngine();
  const actions = useDocumentActions();
  const { copyToClipboard } = useClipboard({
    onSuccess: () => { toast.success(t('freshness.copiedToast')); },
    onError: () => { toast.error(t('common.saveError')); },
  });
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    if (!browser || !owner) { setWaiting([]); return; }
    try {
      const [records, journal] = await Promise.all([browser.engine.listRecoverable(), browser.engine.listPending()]);
      const refused = new Set(journal.filter(entry => entry.state === 'refused').map(entry => entry.command.operationId));
      const documents: Waiting[] = [];
      for (const { record } of records) {
        const resource = record.checkpoint.confirmed.resource;
        if (!ONE_SHOT_COLLECTIONS.includes(resource.collection) || !isCollectionOnEngine(resource.collection)) continue;
        if (record.checkpoint.confirmed.value === null || documents.some(entry => sameResource(entry.resource, resource))) continue;
        const chain = records.filter(entry => sameResource(entry.record.checkpoint.confirmed.resource, resource));
        if (!chain.some(entry => waitsForDecision(entry.record, journal))) continue;
        // The tip of the chain holds the newest text this device has for the document.
        const tip = chain.reduce((best, entry) => entry.record.checkpoint.editGeneration > best.record.checkpoint.editGeneration ? entry : best).record;
        const kind: Kind = tip.checkpoint.draft === null ? 'deleted'
          : chain.some(entry => Object.keys(entry.record.checkpoint.pending).some(id => refused.has(id))) ? 'refused' : 'conflict';
        documents.push({ resource, kind, mine: textOf(tip.checkpoint.draft),
          theirs: textOf(tip.checkpoint.remoteCandidate?.value ?? tip.checkpoint.confirmed.value) });
      }
      // A slower, older pass must not bring back an entry a newer pass already settled.
      if (request === sequence.current) setWaiting(documents);
    } catch (error) {
      // Before the engine knows its owner there is nothing of this person's to list yet.
      if (!(error instanceof Error && error.message === 'Authentication required')) console.error('Engine conflicts could not be listed', error);
    }
  }, [browser, owner]);

  useEffect(() => {
    void refresh();
    if (!browser) return undefined;
    // A late answer arrives as a delivery result: every journal change is a reason to look again.
    const stop = browser.engine.subscribePending(() => { void refresh(); });
    // The result is written into the checkpoint after the journal moves, so a local re-read on a
    // short clock catches it too. It reads this device's IndexedDB only — no database reads.
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, pollMs);
    return () => { stop(); window.clearInterval(timer); };
  }, [browser, refresh, pollMs]);

  const entry = waiting[0];
  if (!entry) return null;

  const settle = async (choice: 'mine' | 'theirs') => {
    if (busy) return;
    setBusy(true);
    try { await actions.resolve(entry.resource, choice); }
    catch (error) {
      console.error('Engine conflict could not be settled', error);
      toast.error(t('common.saveError'));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  if (entry.kind === 'conflict') {
    return (
      <SaveConflictBanner
        entityKey={entry.resource.collection === 'studyNotes' ? 'entityNote' : 'entityRecord'}
        pendingText={entry.mine || undefined}
        onKeepMine={() => { void settle('mine'); }}
        onTakeTheirs={() => { void settle('theirs'); }}
        busy={busy}
        className="mb-3"
      />
    );
  }

  // A refusal is not a choice between two versions: sending the same change again is refused
  // again. The words stay copyable, and the stored version takes their place.
  const refusedChange = entry.kind === 'refused';
  const shown = refusedChange ? entry.mine : entry.theirs;
  const buttonClass = 'rounded-lg px-3 py-1.5 font-medium transition-colors disabled:opacity-60';
  const primary = `${buttonClass} bg-amber-600 text-white hover:bg-amber-700`;
  const secondary = `${buttonClass} border border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20`;
  return (
    <div role="alert" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <p className="font-medium text-amber-900 dark:text-amber-200">
        {refusedChange ? t('dataSync.phase.refused') : t('dataSync.deleteConflictTitle')}
      </p>
      {!refusedChange && <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">{t('dataSync.deleteConflictBody')}</p>}
      {shown && (
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-white/70 px-3 py-2 text-gray-900 dark:bg-gray-900/40 dark:text-gray-100">{shown}</pre>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {refusedChange ? (
          <>
            <button type="button" disabled={busy || !entry.mine} onClick={() => { void copyToClipboard(entry.mine); }} className={primary}>
              {t('freshness.copyTextAction')}
            </button>
            <button type="button" disabled={busy} onClick={() => { void settle('theirs'); }} className={secondary}>
              {t('dataSync.acceptRemote')}
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => { void settle('theirs'); }} className={primary}>
              {t('dataSync.keepRecord')}
            </button>
            <button type="button" disabled={busy} onClick={() => { void settle('mine'); }} className={secondary}>
              {t('dataSync.deleteAnyway')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
