'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import { isCollectionOnEngine, useDataEngine, useDocumentActions, waitsForDecision } from '@/data-engine/react.client';
import { useClipboard } from '@/hooks/useClipboard';

import type { EditorRecord } from '@/data-engine/controller';
import type { DocumentData, JournalEntry, ResourceRef } from '@/data-engine/types';

/**
 * Collections whose screens write through one-shot engine actions (useDocumentActions) and so
 * have no open editor to show a late answer. Councils, groups, series and sermons resolve in
 * their own pinned editors and are deliberately not listed here.
 */
const ONE_SHOT_COLLECTIONS = ['prayerRequests', 'serviceOrders', 'studyNotes', 'tags', 'planTemplates'];
/** Bookkeeping the person never typed: never shown as "your change". */
const BOOKKEEPING = new Set(['updatedAt', 'createdAt', 'rev', 'userId', 'isDraft', '_dataEngine', '_dataEngineOwner']);

/**
 * conflict — another device changed the same field, one draft waits · refused — the server will
 * not take it · refusedCreate — a new record the server would not create · deletedThere — deleted
 * on another device, edited here · deletedHere — deleted here after another device changed it ·
 * several — more than one draft waits, and the engine cannot say which is newest.
 */
type Kind = 'conflict' | 'refused' | 'refusedCreate' | 'deletedThere' | 'deletedHere' | 'several';
interface Waiting { resource: ResourceRef; kind: Kind; mine: string[]; theirs: string }

const show = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
/** Every field a version changed against its base, as "field: value" — steps, tags and structure included. */
function changedText(value: DocumentData | null | undefined, base: DocumentData | null | undefined): string {
  if (!value) return '';
  return Object.keys(value).filter(field => !BOOKKEEPING.has(field) && JSON.stringify(value[field]) !== JSON.stringify(base?.[field]))
    .map(field => `${field}: ${show(value[field])}`).join('\n\n');
}

const sameResource = (a: ResourceRef, b: ResourceRef) => a.collection === b.collection && a.id === b.id;

function kindOf(drafts: EditorRecord[], refused: Set<string>): Kind {
  if (drafts.length > 1) return 'several';
  const { checkpoint } = drafts[0];
  const candidate = checkpoint.remoteCandidate;
  if (checkpoint.confirmed.value === null) return 'refusedCreate';
  if (candidate && (candidate.value === null || candidate.metadata?.deleted)) return 'deletedThere';
  if (checkpoint.draft === null) return 'deletedHere';
  return Object.keys(checkpoint.pending).some(id => refused.has(id)) ? 'refused' : 'conflict';
}

/** One entry per document of the one-shot collections that waits for the person. */
function waitingDocuments(records: readonly { record: EditorRecord }[], journal: readonly JournalEntry[]): Waiting[] {
  const refused = new Set(journal.filter(entry => entry.state === 'refused').map(entry => entry.command.operationId));
  const decided = records.map(entry => entry.record).filter(record => ONE_SHOT_COLLECTIONS.includes(record.checkpoint.confirmed.resource.collection)
    && isCollectionOnEngine(record.checkpoint.confirmed.resource.collection) && waitsForDecision(record, journal));
  const documents: Waiting[] = [];
  for (const record of decided) {
    const resource = record.checkpoint.confirmed.resource;
    if (documents.some(entry => sameResource(entry.resource, resource))) continue;
    const drafts = decided.filter(entry => sameResource(entry.checkpoint.confirmed.resource, resource));
    const { checkpoint } = drafts[0];
    documents.push({ resource, kind: kindOf(drafts, refused),
      mine: drafts.map(draft => changedText(draft.checkpoint.draft, draft.checkpoint.confirmed.value)).filter(Boolean),
      theirs: changedText(checkpoint.remoteCandidate?.value ?? checkpoint.confirmed.value, null) });
  }
  return documents;
}

/**
 * AN ANSWER THE SERVER GAVE AFTER THIS DEVICE KEPT THE CHANGE, FOR A DOCUMENT NO SCREEN HAS OPEN.
 *
 * A one-shot action is accepted once the engine holds it on this device. When the server then
 * answers with a conflict or a refusal, the list shows the stored version while this device's
 * words wait in closed checkpoints, and further one-shot changes to that document are refused
 * until the person decides here. The banner never chooses for them: "keep mine" is offered only
 * for a single waiting draft of a document that still exists; otherwise every draft is shown in
 * full for copying and the one choice is the stored version. App-wide, like the legacy
 * OutboxConflictBanner.
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
      const documents = waitingDocuments(records, journal);
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

  const mine = entry.mine.join('\n\n———\n\n');
  if (entry.kind === 'conflict') {
    return (
      <SaveConflictBanner
        entityKey={entry.resource.collection === 'studyNotes' ? 'entityNote' : 'entityRecord'}
        pendingText={mine || undefined}
        onKeepMine={() => { void settle('mine'); }}
        onTakeTheirs={() => { void settle('theirs'); }}
        busy={busy}
        className="mb-3"
      />
    );
  }

  const heading: Record<Exclude<Kind, 'conflict'>, [string, string | null]> = {
    refused: [t('dataSync.phase.refused'), null],
    refusedCreate: [t('dataSync.phase.refused'), null],
    deletedThere: [t('freshness.deletedElsewhereTitle'), t('freshness.deletedElsewhereBody')],
    deletedHere: [t('dataSync.deleteConflictTitle'), t('dataSync.deleteConflictBody')],
    several: [t('freshness.conflictTitle'), t('dataSync.severalDrafts')],
  };
  const [title, body] = heading[entry.kind];
  const shown = entry.kind === 'deletedHere' ? entry.theirs : mine;
  const buttonClass = 'rounded-lg px-3 py-1.5 font-medium transition-colors disabled:opacity-60';
  const primary = `${buttonClass} bg-amber-600 text-white hover:bg-amber-700`;
  const secondary = `${buttonClass} border border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20`;
  return (
    <div role="alert" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <p className="font-medium text-amber-900 dark:text-amber-200">{title}</p>
      {body && <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">{body}</p>}
      {shown && (
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-white/70 px-3 py-2 text-gray-900 dark:bg-gray-900/40 dark:text-gray-100">{shown}</pre>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {entry.kind === 'deletedHere' ? (
          <>
            <button type="button" disabled={busy} onClick={() => { void settle('theirs'); }} className={primary}>{t('dataSync.keepRecord')}</button>
            <button type="button" disabled={busy} onClick={() => { void settle('mine'); }} className={secondary}>{t('dataSync.deleteAnyway')}</button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy || !mine} onClick={() => { void copyToClipboard(mine); }} className={primary}>{t('freshness.copyTextAction')}</button>
            <button type="button" disabled={busy} onClick={() => { void settle('theirs'); }} className={secondary}>
              {entry.kind === 'deletedThere' || entry.kind === 'refusedCreate' ? t('freshness.discardAction') : t('dataSync.acceptRemote')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
