'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import { isCollectionOnEngine, isDataEngineEnabled, isOneShotRecord, useDataEngine, useDocumentActions, waitsForDecision } from '@/data-engine/react.client';
import { useClipboard } from '@/hooks/useClipboard';
import { useShellPathname } from '@/hooks/useShellPathname';
import { documentScreenHref, isOnDocumentScreen } from '@/utils/documentScreenHref';

import type { EditorRecord } from '@/data-engine/controller';
import type { DocumentData, JournalEntry, ResourceRef } from '@/data-engine/types';

/** Bookkeeping the person never typed: never shown as "your change". */
const BOOKKEEPING = new Set(['updatedAt', 'createdAt', 'rev', 'userId', 'isDraft', 'planMode', '_dataEngine', '_dataEngineOwner']);

/**
 * conflict — another device changed the same field, one draft waits · refused — the server will
 * not take it · refusedCreate — a new record the server would not create · deletedThere — deleted
 * on another device, edited here · deletedHere — deleted here after another device changed it ·
 * refusedDelete — the server refused a deletion made here (another device may also have changed it) ·
 * several — more than one draft waits, and the engine cannot say which is newest.
 */
type Kind = 'conflict' | 'refused' | 'refusedCreate' | 'deletedThere' | 'deletedHere' | 'refusedDelete' | 'several';
/**
 * `screen`: the draft belongs to a screen's editor, so it is decided on that screen, not here —
 * when `decidable`: a screen opened now takes the work over. Otherwise (several chains of requests,
 * between which the engine never picks) no screen can, and the stored version is offered here.
 */
interface Waiting { resource: ResourceRef; kind: Kind; mine: string[]; theirs: string; screen: boolean; decidable?: boolean; heldOpen?: boolean; formWork?: boolean }

/** The look both notices share: one for a change decided here, one for a screen's draft decided there. */
const REFUSED_TITLE = 'dataSync.phase.refused';
const CONFLICT_TITLE = 'freshness.conflictTitle';
const COPY_ACTION = 'freshness.copyTextAction';
const NOTICE_BOX = 'mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10';
const NOTICE_TITLE = 'font-medium text-amber-900 dark:text-amber-200';
const NOTICE_BODY = 'mt-0.5 text-amber-800/80 dark:text-amber-200/70';
const NOTICE_TEXT = 'mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-white/70 px-3 py-2 text-gray-900 dark:bg-gray-900/40 dark:text-gray-100';

/**
 * A value as the person wrote it. Text kept per node (a plan's cells, keyed by node ids nobody ever
 * sees) reads as the texts themselves; anything else is shown as stored.
 */
const show = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const texts = Object.values(value as Record<string, unknown>);
    if (texts.length && texts.every(text => typeof text === 'string')) return (texts as string[]).filter(text => text.trim()).join('\n\n');
  }
  return JSON.stringify(value, null, 2);
};
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
  const wasRefused = Object.keys(checkpoint.pending).some(id => refused.has(id));
  // A refusal is not proof of a conflict: naming "another device" as its reason may be false.
  if (checkpoint.draft === null) return wasRefused ? 'refusedDelete' : 'deletedHere';
  return wasRefused ? 'refused' : 'conflict';
}

/**
 * One entry per document whose change waits for the person, in any engine collection — a one-shot
 * change first, then a screen's draft.
 *
 * Chosen by what left the draft, not by collection: a list-row menu, a link made from the other
 * side of a relation or a sermon born from a note has no open editor to show a late answer — a
 * sermon's one-shot actions used to fall outside a fixed list of collections and were answered
 * nowhere. Those are decided here. A screen's draft, refused after the person left that screen, is
 * only SHOWN here, with the way back: that screen offers the choice when opened (a second place
 * deciding one draft is how an answer gets taken twice). Once decided there, the draft stops
 * waiting (`reconcileRecoveryRecord`) and the entry goes (BUG-20260813-late-refusal-silent-after-navigation).
 */
function waitingDocuments(records: readonly { record: EditorRecord }[], journal: readonly JournalEntry[]): Waiting[] {
  const refused = new Set(journal.filter(entry => entry.state === 'refused').map(entry => entry.command.operationId));
  const answered = new Set(journal.filter(entry => entry.state === 'refused' || entry.state === 'conflict').map(entry => entry.command.operationId));
  // A screen's draft is listed for an ANSWER the server gave; one waiting only on a conflict seen
  // while it was open has no request to take back here.
  const decided = records.map(entry => entry.record).filter(record => isCollectionOnEngine(record.checkpoint.confirmed.resource.collection)
    && waitsForDecision(record, journal) && (isOneShotRecord(record) || Object.keys(record.checkpoint.pending).some(id => answered.has(id))));
  const documents: Waiting[] = [];
  for (const screen of [false, true]) {
    for (const record of decided.filter(entry => isOneShotRecord(entry) !== screen)) {
      const resource = record.checkpoint.confirmed.resource;
      if (documents.some(entry => entry.screen === screen && sameResource(entry.resource, resource))) continue;
      const drafts = decided.filter(entry => isOneShotRecord(entry) !== screen && sameResource(entry.checkpoint.confirmed.resource, resource));
      const { checkpoint } = drafts[0];
      documents.push({ resource, kind: kindOf(drafts, refused), screen,
        mine: drafts.map(draft => changedText(draft.checkpoint.draft, draft.checkpoint.confirmed.value)).filter(Boolean),
        theirs: changedText(checkpoint.remoteCandidate?.value ?? checkpoint.confirmed.value, null) });
    }
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
  return isDataEngineEnabled() ? <EngineConflicts pollMs={pollMs} /> : null;
}

function EngineConflicts({ pollMs }: { pollMs: number }) {
  const { t } = useTranslation();
  const { browser, owner } = useDataEngine();
  const actions = useDocumentActions();
  const { copyToClipboard } = useClipboard({
    onSuccess: () => { toast.success(t('freshness.copiedToast')); },
    onError: () => { toast.error(t('common.saveError')); },
  });
  // The offline shell's router stands at /~offline; the open screen is the window's address.
  const pathname = useShellPathname();
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    if (!browser || !owner) { setWaiting([]); return; }
    try {
      const [records, journal] = await Promise.all([browser.engine.listRecoverable(), browser.engine.listPending()]);
      const listed = await Promise.all(waitingDocuments(records, journal).map(async entry => (
        entry.screen ? { ...entry, formWork: await browser.engine.formWorkPending(entry.resource),
          decidable: await browser.engine.screenDecides(entry.resource), heldOpen: await browser.engine.answerHeldOpen(entry.resource) } : entry)));
      // A form's answer is resolved by its form, as it always was; it is not said here.
      const documents = listed.filter(entry => !('formWork' in entry && entry.formWork));
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

  // A screen's draft is not shown on its screen when the editor open there holds the answer: that
  // screen's status already says it, once. One opened before the request existed holds nothing.
  const entry = waiting.find(candidate => !candidate.screen || !candidate.heldOpen || !isOnDocumentScreen(pathname, candidate.resource));
  if (!entry) return null;

  const settle = async (choice: 'mine' | 'theirs') => {
    if (busy) return;
    setBusy(true);
    try {
      if (entry.screen) await browser?.engine.takeStoredVersion(entry.resource);
      else await actions.resolve(entry.resource, choice);
    }
    catch (error) {
      console.error('Engine conflict could not be settled', error);
      toast.error(t('common.saveError'));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const mine = entry.mine.join('\n\n———\n\n');
  if (entry.screen) {
    return entry.decidable
      ? <ScreenDraftNotice entry={entry} mine={mine} onCopy={() => { void copyToClipboard(mine); }} />
      : <UndecidableScreenDrafts entry={entry} mine={mine} busy={busy} onCopy={() => { void copyToClipboard(mine); }} onTakeStored={() => { void settle('theirs'); }} />;
  }
  if (entry.kind === 'conflict') {
    return (
      <SaveConflictBanner
        entityKey={entry.resource.collection === 'studyNotes' ? 'entityNote' : entry.resource.collection === 'sermons' ? 'entitySermon' : 'entityRecord'}
        pendingText={mine || undefined}
        onKeepMine={() => { void settle('mine'); }}
        onTakeTheirs={() => { void settle('theirs'); }}
        busy={busy}
        className="mb-3"
      />
    );
  }

  const heading: Record<Exclude<Kind, 'conflict'>, [string, string | null]> = {
    refused: [t(REFUSED_TITLE), null],
    refusedCreate: [t(REFUSED_TITLE), null],
    deletedThere: [t('freshness.deletedElsewhereTitle'), t('freshness.deletedElsewhereBody')],
    deletedHere: [t('dataSync.deleteConflictTitle'), t('dataSync.deleteConflictBody')],
    refusedDelete: [t('dataSync.deleteRefusedTitle'), t('dataSync.deleteRefusedBody')],
    several: [t(CONFLICT_TITLE), t('dataSync.severalDrafts')],
  };
  const [title, body] = heading[entry.kind];
  const deletion = entry.kind === 'deletedHere' || entry.kind === 'refusedDelete';
  const shown = deletion ? entry.theirs : mine;
  const buttonClass = 'rounded-lg px-3 py-1.5 font-medium transition-colors disabled:opacity-60';
  const primary = `${buttonClass} bg-amber-600 text-white hover:bg-amber-700`;
  const secondary = `${buttonClass} border border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20`;
  return (
    <div role="alert" className={NOTICE_BOX}>
      <p className={NOTICE_TITLE}>{title}</p>
      {body && <p className={NOTICE_BODY}>{body}</p>}
      {shown && (
        <pre className={NOTICE_TEXT}>{shown}</pre>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {deletion ? (
          <>
            <button type="button" disabled={busy} onClick={() => { void settle('theirs'); }} className={primary}>{t('dataSync.keepRecord')}</button>
            <button type="button" disabled={busy} onClick={() => { void settle('mine'); }} className={secondary}>
              {entry.kind === 'refusedDelete' ? t('dataSync.retryDelete') : t('dataSync.deleteAnyway')}
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy || !mine} onClick={() => { void copyToClipboard(mine); }} className={primary}>{t(COPY_ACTION)}</button>
            <button type="button" disabled={busy} onClick={() => { void settle('theirs'); }} className={secondary}>
              {entry.kind === 'deletedThere' || entry.kind === 'refusedCreate' ? t('freshness.discardAction') : t('dataSync.acceptRemote')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A SCREEN'S DRAFT THE SERVER ANSWERED AFTER THE PERSON LEFT THAT SCREEN — said once, anywhere,
 * with its text, and the way to the screen that decides it. No choice is made here.
 */
function ScreenDraftNotice({ entry, mine, onCopy }: { entry: Waiting; mine: string; onCopy: () => void }) {
  const { t } = useTranslation();
  const href = documentScreenHref(entry.resource);
  const title = entry.kind === 'refused' || entry.kind === 'refusedCreate' || entry.kind === 'refusedDelete'
    ? t(REFUSED_TITLE) : t(CONFLICT_TITLE);
  const buttonClass = 'rounded-lg px-3 py-1.5 font-medium transition-colors';
  return (
    <div role="alert" className={NOTICE_BOX}>
      <p className={NOTICE_TITLE}>{title}</p>
      <p className={NOTICE_BODY}>{t('dataSync.screenDraftBody')}</p>
      {mine && (
        <pre className={NOTICE_TEXT}>{mine}</pre>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {href && <Link href={href} className={`${buttonClass} bg-amber-600 text-white hover:bg-amber-700`}>{t('dataSync.openToDecide')}</Link>}
        {mine && (
          <button type="button" onClick={onCopy}
            className={`${buttonClass} border border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20`}>
            {t(COPY_ACTION)}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * SCREEN DRAFTS NO SCREEN CAN DECIDE: several chains of requests answered for one document, between
 * which the engine never picks, so a screen opened on it takes none of them over. Every draft is shown
 * in full for copying, and the one choice is the server's version — as for several one-shot drafts.
 */
function UndecidableScreenDrafts({ entry, mine, busy, onCopy, onTakeStored }: {
  entry: Waiting; mine: string; busy: boolean; onCopy: () => void; onTakeStored: () => void;
}) {
  const { t } = useTranslation();
  const title = entry.kind === 'refused' || entry.kind === 'refusedCreate' || entry.kind === 'refusedDelete'
    ? t(REFUSED_TITLE) : t(CONFLICT_TITLE);
  const buttonClass = 'rounded-lg px-3 py-1.5 font-medium transition-colors disabled:opacity-60';
  return (
    <div role="alert" className={NOTICE_BOX}>
      <p className={NOTICE_TITLE}>{title}</p>
      <p className={NOTICE_BODY}>{t('dataSync.screenDraftsUndecidable')}</p>
      {mine && <pre className={NOTICE_TEXT}>{mine}</pre>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !mine} onClick={onCopy} className={`${buttonClass} bg-amber-600 text-white hover:bg-amber-700`}>{t(COPY_ACTION)}</button>
        <button type="button" disabled={busy} onClick={onTakeStored}
          className={`${buttonClass} border border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20`}>
          {t('dataSync.acceptRemote')}
        </button>
      </div>
    </div>
  );
}
