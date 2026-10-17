'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import { captureRecoveryChoice, isCollectionOnEngine, isDataEngineEnabled, isOneShotRecord, isRecoveryHeldOpen, useDataEngine, useDocumentActions, useOpenDocumentAnswerScopes, waitsForDecision, type OpenDocumentAnswer, type RecoveryChoiceScope } from '@/data-engine/react.client';
import { useClipboard } from '@/hooks/useClipboard';
import { useConfirm, useDiscardQuestion } from '@/hooks/useConfirm';
import { useShellPathname } from '@/hooks/useShellPathname';
import { refusalMessage } from '@/utils/actionFailureMessage';
import { resolveAppLocale } from '@/utils/appLocale';
import { isBibleId } from '@/utils/bibles';
import { documentScreenHref, isOnDocumentScreen } from '@/utils/documentScreenHref';
import { formatScriptureReference, type ScriptureRefShape } from '@/utils/scriptureReference';
import { fieldLabel } from '@/utils/storedFieldLabel';
import { storedFieldValue } from '@/utils/storedFieldValue';
import { useTranslation } from '@locales/useTranslation';

import type { EditorRecord, RecoveryCheckpoint } from '@/data-engine/controller';
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
 * `screen`: the draft belongs to a screen's editor, so its words are kept on that screen, not here —
 * when `decidable`: a screen opened now takes the work over; the stored version is offered here as
 * well. Otherwise (several chains of requests, between which the engine never picks) no screen can,
 * and the stored version is the one choice, offered here.
 */
interface Waiting extends RecoveryChoiceScope { resource: ResourceRef; kind: Kind; mine: string[]; theirs: string; screen: boolean; decidable?: boolean; formWork?: boolean }

/** The look both notices share: one for a change decided here, one for a screen's draft decided there. */
const REFUSED_TITLE = 'dataSync.phase.refused';
const CONFLICT_TITLE = 'freshness.conflictTitle';
const COPY_ACTION = 'freshness.copyTextAction';
const ACCEPT_REMOTE = 'dataSync.acceptRemote';
const BUTTON = 'rounded-lg px-3 py-1.5 font-medium transition-colors disabled:opacity-60';
const PRIMARY_BUTTON = `${BUTTON} bg-amber-600 text-white hover:bg-amber-700`;
const SECONDARY_BUTTON = `${BUTTON} border border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20`;
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
type Item = Record<string, unknown> & { id: string };
type DisplayValue = (scope: string, field: string, value: unknown) => unknown;
const isItem = (value: unknown): value is Item => Boolean(value) && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string';
const REFERENCE_COORDINATES = ['chapter', 'toChapter', 'fromVerse', 'endChapter', 'toVerse'];
const REFERENCE_FIELDS = new Set(['id', 'bible', 'book', 'text', ...REFERENCE_COORDINATES]);

/** The canonical reader owns the numbers; unsupported evidence stays complete rather than disappearing. */
function referenceItemText(item: Item, language: string): string {
  const supported = typeof item.book === 'string' && item.book.trim()
    && (item.bible === undefined || isBibleId(item.bible))
    && (item.text === undefined || typeof item.text === 'string')
    && REFERENCE_COORDINATES.every(field => item[field] === undefined || (Number.isSafeInteger(item[field]) && Number(item[field]) > 0))
    && Object.keys(item).every(field => REFERENCE_FIELDS.has(field) || BOOKKEEPING.has(field) || /Ids?$/.test(field));
  if (!supported) return show(item);
  return [formatScriptureReference(item as Item & ScriptureRefShape, { locale: resolveAppLocale(language), style: 'long' }),
    typeof item.text === 'string' ? item.text : ''].filter(text => text.trim()).join('\n');
}

/** Fields that name an item first, when it has them; any other words come after. */
const NAMING_FIELDS = ['text', 'title', 'name', 'instanceTitle'];
/**
 * What the person wrote in one item: words, short text lists and schema-labelled scalar choices;
 * never an id, placement, a link to another item or a moment written down by the app.
 */
function itemWords(item: Item, scope: string, display: DisplayValue, name: (field: string) => string): [string, string][] {
  const words = (field: string, value: unknown): string => {
    if (field === 'id' || /Ids?$/.test(field) || BOOKKEEPING.has(field)) return '';
    const shown = display(scope, field, value);
    if (typeof value === 'string') return /^\d{4}-\d{2}-\d{2}T/.test(value) ? '' : String(shown).trim();
    if (typeof shown === 'string') return `${name(field)}: ${shown}`;
    return Array.isArray(value) && value.every(entry => typeof entry === 'string') ? value.join(', ') : '';
  };
  const fields = [...NAMING_FIELDS.filter(field => field in item), ...Object.keys(item).filter(field => !NAMING_FIELDS.includes(field))];
  return fields.map((field): [string, string] => [field, words(field, item[field])]).filter(([, text]) => text);
}
/**
 * One changed item in words: the words that changed, with its name first when the name stayed;
 * just its name when only its place or links changed. Null when it has no words at all.
 */
function changedItem(item: Item, before: Item | undefined, scope: string, display: DisplayValue, label: (field: string) => string): string | null {
  const formatted = display(scope, '', item);
  if (typeof formatted === 'string') return formatted;
  const words = itemWords(item, scope, display, label);
  if (!words.length) return null;
  const was = new Map(before ? itemWords(before, scope, display, label) : []);
  const changed = words.filter(([field, text]) => was.get(field) !== text);
  const [name] = words;
  if (!changed.length) return name[1];
  return (changed.includes(name) ? changed : [name, ...changed]).map(([, text]) => text).join('\n');
}
/**
 * A list of items with ids reads as the words of the items this version added or changed — never
 * their ids, positions or links, and never the items it left as they were
 * (BUG-20261013-refused-thoughts-notice-shows-raw-data). An item changed without any words is
 * never hidden: then the whole structure is shown, with known choices labelled as on screen.
 */
const showList = (value: unknown[], base: unknown, scope: string, field: string, display: DisplayValue, name: (field: string) => string): string => {
  if (!value.every(isItem)) return show(display(scope, field, value));
  const before = new Map((Array.isArray(base) ? base.filter(isItem) : []).map(item => [item.id, item]));
  const changed = value.filter(item => JSON.stringify(before.get(item.id)) !== JSON.stringify(item))
    .map(item => changedItem(item, before.get(item.id), `${scope}.${field}`, display, name));
  return changed.includes(null) ? show(display(scope, field, value)) : changed.join('\n\n');
};
/** Every field a version changed against its base, as "field: value" — steps, tags and structure included. */
function changedText(value: DocumentData | null | undefined, base: DocumentData | null | undefined, name: (field: string) => string, scope: string, display: DisplayValue): string {
  if (!value) return '';
  return Object.keys(value).filter(field => !BOOKKEEPING.has(field) && JSON.stringify(value[field]) !== JSON.stringify(base?.[field]))
    .map(field => {
      const shown = Array.isArray(value[field]) ? showList(value[field] as unknown[], base?.[field], scope, field, display, name) : show(display(scope, field, value[field]));
      return shown ? `${name(field)}: ${shown}` : '';
    }).filter(Boolean).join('\n\n');
}

const sameResource = (a: ResourceRef, b: ResourceRef) => a.collection === b.collection && a.id === b.id;
const sameWaitingChoice = (current: Waiting | null | undefined, target: Waiting) => Boolean(current
  && sameResource(current.resource, target.resource)
  && current.kind === target.kind
  && current.screen === target.screen
  && current.fingerprint === target.fingerprint
  && current.operationIds.length === target.operationIds.length
  && current.operationIds.every((id, index) => id === target.operationIds[index]));

/** A matching route yields only when its document editors hold all the shown work and words. */
function visibleWaiting(candidates: readonly Waiting[] | null | undefined, pathname: string | null | undefined,
  answers: readonly OpenDocumentAnswer[]): Waiting | undefined {
  return candidates?.find(candidate => !isOnDocumentScreen(pathname, candidate.resource)
    || !isRecoveryHeldOpen(candidate.records, answers));
}

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
 * shown here with the way back: keeping its words needs that screen's editor. Only the stored
 * version is taken here, by `takeStoredVersion`, which settles every copy of the draft, a screen
 * still open in another tab included (BUG-20261013-screen-draft-notice-offers-no-choice). Once
 * decided, the draft stops waiting (`reconcileRecoveryRecord`) and the entry goes
 * (BUG-20260813-late-refusal-silent-after-navigation).
 */
function waitingDocuments(records: readonly RecoveryCheckpoint[], journal: readonly JournalEntry[], name: (field: string) => string, display: DisplayValue): Waiting[] {
  const refused = new Set(journal.filter(entry => entry.state === 'refused').map(entry => entry.command.operationId));
  for (const { record, answer } of records) if (answer === 'refused') Object.keys(record.checkpoint.pending).forEach(id => refused.add(id));
  const answered = new Set(journal.filter(entry => entry.state === 'refused' || entry.state === 'conflict').map(entry => entry.command.operationId));
  // A screen is listed for an answered saved request, including a local policy refusal.
  // A conflict in an unsent screen draft has no submitted request to settle here.
  const decided = records.filter(({ record, answer }) => isCollectionOnEngine(record.checkpoint.confirmed.resource.collection)
    && waitsForDecision(record, journal, answer) && (isOneShotRecord(record) || Boolean(answer)
      || Object.keys(record.checkpoint.pending).some(id => answered.has(id)))).map(entry => entry.record);
  const documents: Waiting[] = [];
  for (const screen of [false, true]) {
    for (const record of decided.filter(entry => isOneShotRecord(entry) !== screen)) {
      const resource = record.checkpoint.confirmed.resource;
      if (documents.some(entry => entry.screen === screen && sameResource(entry.resource, resource))) continue;
      const drafts = decided.filter(entry => isOneShotRecord(entry) !== screen && sameResource(entry.checkpoint.confirmed.resource, resource));
      const { checkpoint } = drafts[0];
      const scope = captureRecoveryChoice(drafts);
      // Every opening of a screen keeps its own copy of a draft it took over: the same words are said once.
      documents.push({ resource, kind: kindOf(drafts, refused), screen,
        mine: [...new Set(drafts.map(draft => changedText(draft.checkpoint.draft, draft.checkpoint.confirmed.value, name, resource.collection, display)).filter(Boolean))],
        theirs: changedText(checkpoint.remoteCandidate?.value ?? checkpoint.confirmed.value, null, name, resource.collection, display),
        ...scope });
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
  const { t, language: interfaceLanguage } = useTranslation();
  const { browser, owner } = useDataEngine();
  const { askBeforeDiscard, discardDialog, withdraw } = useDiscardQuestion('text');
  const { confirm, confirmDialog, withdraw: withdrawDelete } = useConfirm();
  const openAnswers = useOpenDocumentAnswerScopes();
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
  const browserRef = useRef(browser);
  const ownerRef = useRef(owner);
  const entryRef = useRef<Waiting | null>(null);
  const pendingChoice = useRef<{ target: Waiting; browser: typeof browser; owner: typeof owner } | null>(null);
  browserRef.current = browser;
  ownerRef.current = owner;
  // Field names in the person's words, as on the list of legacy copies. Read through a ref: `t` is
  // no key for the list's effect — a new function on a render would restart it in a loop.
  const fieldNameRef = useRef((field: string) => fieldLabel(t, field));
  fieldNameRef.current = (field: string) => fieldLabel(t, field);

  const displayValue: DisplayValue = (scope, field, value) => scope === 'studyNotes.scriptureRefs' && !field && isItem(value)
    ? referenceItemText(value, interfaceLanguage) : storedFieldValue(t, scope, field, value);
  const displayRef = useRef<DisplayValue>(displayValue);
  displayRef.current = displayValue;

  const refresh = useCallback(async (): Promise<Waiting[] | null> => {
    const request = ++sequence.current;
    if (!browser || !owner) {
      if (browserRef.current === browser && ownerRef.current === owner) setWaiting([]);
      return [];
    }
    try {
      const [records, journal] = await Promise.all([browser.engine.listRecoverable(), browser.engine.listPending()]);
      const listed = await Promise.all(waitingDocuments(records, journal, fieldNameRef.current, displayRef.current).map(async entry => (
        entry.screen ? { ...entry, formWork: await browser.engine.formWorkPending(entry.resource),
          decidable: await browser.engine.screenDecides(entry.resource) } : entry)));
      // A form's answer is resolved by its form, as it always was; it is not said here.
      const documents = listed.filter(entry => !('formWork' in entry && entry.formWork));
      // A slower, older pass must not bring back an entry a newer pass already settled.
      if (request === sequence.current && browserRef.current === browser && ownerRef.current === owner) {
        setWaiting(documents);
        return documents;
      }
      return null;
    } catch (error) {
      // Before the engine knows its owner there is nothing of this person's to list yet.
      if (!(error instanceof Error && error.message === 'Authentication required')) console.error('Engine conflicts could not be listed', error);
      return null;
    }
  }, [browser, owner]);

  const readCurrentWaiting = useCallback(async (targetBrowser: typeof browser, targetOwner: typeof owner): Promise<Waiting[] | null> => {
    if (!targetBrowser || !targetOwner || browserRef.current !== targetBrowser || ownerRef.current !== targetOwner) return null;
    try {
      const [records, journal] = await Promise.all([targetBrowser.engine.listRecoverable(), targetBrowser.engine.listPending()]);
      const listed = await Promise.all(waitingDocuments(records, journal, fieldNameRef.current, displayRef.current).map(async candidate => (
        candidate.screen ? { ...candidate, formWork: await targetBrowser.engine.formWorkPending(candidate.resource),
          decidable: await targetBrowser.engine.screenDecides(candidate.resource) } : candidate)));
      if (browserRef.current !== targetBrowser || ownerRef.current !== targetOwner) return null;
      return listed.filter(candidate => !('formWork' in candidate && candidate.formWork));
    } catch (error) {
      if (!(error instanceof Error && error.message === 'Authentication required')) console.error('Engine conflicts could not be listed', error);
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!browser) return undefined;
    // A late answer arrives as a delivery result: every journal change is a reason to look again.
    const stop = browser.engine.subscribePending(() => { void refresh(); });
    // The result is written into the checkpoint after the journal moves, so a local re-read on a
    // short clock catches it too. It reads this device's IndexedDB only — no database reads.
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, pollMs);
    return () => { stop(); window.clearInterval(timer); sequence.current += 1; withdraw(); };
  }, [browser, refresh, pollMs, interfaceLanguage, withdraw]);

  // One question for the same held work, regardless of which editor originally captured it.
  // Other requests or unseen draft words keep their global notice.
  const entry = visibleWaiting(waiting, pathname, openAnswers);
  entryRef.current = entry ?? null;
  useEffect(() => {
    const pending = pendingChoice.current;
    if (pending && (browser !== pending.browser || owner !== pending.owner || !sameWaitingChoice(entryRef.current, pending.target))) {
      pendingChoice.current = null;
      withdraw();
      withdrawDelete();
    }
  }, [browser, owner, waiting, openAnswers, pathname, withdraw, withdrawDelete]);
  if (!entry) return <>{discardDialog}{confirmDialog}</>;

  const askBeforeSettling = async (target: Waiting, choice: 'mine' | 'theirs') => {
    const targetBrowser = browser;
    const targetOwner = owner;
    const pending = { target, browser: targetBrowser, owner: targetOwner };
    pendingChoice.current = pending;
    const isCurrent = () => browserRef.current === targetBrowser && ownerRef.current === targetOwner && sameWaitingChoice(entryRef.current, target);
    try {
      await askBeforeDiscard(true, async () => {
        const fresh = await readCurrentWaiting(targetBrowser, targetOwner);
        const currentEntry = visibleWaiting(fresh, pathname, openAnswers);
        if (browserRef.current !== targetBrowser || ownerRef.current !== targetOwner
          || !sameWaitingChoice(currentEntry, target) || !sameWaitingChoice(entryRef.current, target)) return;
        await settle(choice, targetBrowser, target);
      }, isCurrent);
    } finally {
      if (pendingChoice.current === pending) pendingChoice.current = null;
    }
  };

  const askBeforeDelete = async (target: Waiting) => {
    const targetBrowser = browser;
    const targetOwner = owner;
    const isCurrent = () => browserRef.current === targetBrowser && ownerRef.current === targetOwner && sameWaitingChoice(entryRef.current, target);
    if (!isCurrent()) return;
    const pending = { target, browser: targetBrowser, owner: targetOwner };
    pendingChoice.current = pending;
    try {
      const accepted = await confirm({
        title: { key: 'common.deleteItem.title' },
        description: { key: 'common.deleteItem.description' },
        confirmText: { key: 'common.delete' },
        cancelText: { key: 'common.cancel' },
      });
      if (!accepted || !isCurrent()) return;
      const fresh = await readCurrentWaiting(targetBrowser, targetOwner);
      const currentEntry = visibleWaiting(fresh, pathname, openAnswers);
      if (!sameWaitingChoice(currentEntry, target) || !isCurrent()) return;
      await settle('mine', targetBrowser, target);
    } finally {
      if (pendingChoice.current === pending) pendingChoice.current = null;
    }
  };

  const settle = async (choice: 'mine' | 'theirs', targetBrowser = browser, target = entry) => {
    if (busy) return;
    setBusy(true);
    try {
      if (target.screen) await targetBrowser?.engine.takeStoredVersion(target.resource, target.operationIds);
      else await actions.resolve(target.resource, choice, target);
    }
    catch (error) {
      console.error('Engine conflict could not be settled', error);
      // A refusal may be an instruction; it is said in words (BUG-20261003-engine-refusals-speak-english).
      toast.error(refusalMessage(error, t, 'common.saveError'));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const mine = entry.mine.join('\n\n———\n\n');
  if (entry.screen) {
    return <>
      {entry.decidable
        ? <ScreenDraftNotice entry={entry} mine={mine} busy={busy} onCopy={() => { void copyToClipboard(mine); }} onTakeStored={() => { void askBeforeSettling(entry, 'theirs'); }} />
        : <UndecidableScreenDrafts entry={entry} mine={mine} busy={busy} onCopy={() => { void copyToClipboard(mine); }} onTakeStored={() => { void askBeforeSettling(entry, 'theirs'); }} />}
      {discardDialog}{confirmDialog}
    </>;
  }
  if (entry.kind === 'conflict') {
    return (
      <>
        <SaveConflictBanner
          entityKey={entry.resource.collection === 'studyNotes' ? 'entityNote' : entry.resource.collection === 'sermons' ? 'entitySermon' : 'entityRecord'}
          pendingText={mine || undefined}
          onKeepMine={() => { void settle('mine'); }}
          onTakeTheirs={() => { void askBeforeSettling(entry, 'theirs'); }}
          busy={busy}
          className="mb-3"
        />
        {discardDialog}{confirmDialog}
      </>
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
  return (
    <>
    <div role="alert" className={NOTICE_BOX}>
      <p className={NOTICE_TITLE}>{title}</p>
      {body && <p className={NOTICE_BODY}>{body}</p>}
      {shown && (
        <pre className={NOTICE_TEXT}>{shown}</pre>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {deletion ? (
          <>
            <button type="button" disabled={busy} onClick={() => { void settle('theirs'); }} className={PRIMARY_BUTTON}>{t('dataSync.keepRecord')}</button>
            <button type="button" disabled={busy} onClick={() => { void (entry.theirs ? askBeforeDelete(entry) : settle('mine')); }} className={SECONDARY_BUTTON}>
              {entry.kind === 'refusedDelete' ? t('dataSync.retryDelete') : t('dataSync.deleteAnyway')}
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy || !mine} onClick={() => { void copyToClipboard(mine); }} className={PRIMARY_BUTTON}>{t(COPY_ACTION)}</button>
            <button type="button" disabled={busy} onClick={() => { void askBeforeSettling(entry, 'theirs'); }} className={SECONDARY_BUTTON}>
              {entry.kind === 'deletedThere' || entry.kind === 'refusedCreate' ? t('freshness.discardAction') : t(ACCEPT_REMOTE)}
            </button>
          </>
        )}
      </div>
    </div>
    {discardDialog}{confirmDialog}
    </>
  );
}

/**
 * A SCREEN'S DRAFT THE SERVER ANSWERED AFTER THE PERSON LEFT THAT SCREEN — said once, anywhere,
 * with its text. Keeping the words needs that screen's editor, so it is reached by the link; the
 * stored version is taken here (BUG-20261013-screen-draft-notice-offers-no-choice): a notice on
 * every page with nothing to decide in it was all the person saw. `takeStoredVersion` settles every
 * copy of the draft, the screen open in another tab included.
 */
function ScreenDraftNotice({ entry, mine, busy, onCopy, onTakeStored }: {
  entry: Waiting; mine: string; busy: boolean; onCopy: () => void; onTakeStored: () => void;
}) {
  const { t } = useTranslation();
  const href = documentScreenHref(entry.resource);
  const title = entry.kind === 'refused' || entry.kind === 'refusedCreate' || entry.kind === 'refusedDelete'
    ? t(REFUSED_TITLE) : t(CONFLICT_TITLE);
  return (
    <div role="alert" className={NOTICE_BOX}>
      <p className={NOTICE_TITLE}>{title}</p>
      <p className={NOTICE_BODY}>{t('dataSync.screenDraftBody')}</p>
      {mine && (
        <pre className={NOTICE_TEXT}>{mine}</pre>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {href && <Link href={href} className={PRIMARY_BUTTON}>{t('dataSync.openToDecide')}</Link>}
        <button type="button" disabled={busy} onClick={onTakeStored} className={SECONDARY_BUTTON}>{t(ACCEPT_REMOTE)}</button>
        {mine && <button type="button" disabled={busy} onClick={onCopy} className={SECONDARY_BUTTON}>{t(COPY_ACTION)}</button>}
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
  return (
    <div role="alert" className={NOTICE_BOX}>
      <p className={NOTICE_TITLE}>{title}</p>
      <p className={NOTICE_BODY}>{t('dataSync.screenDraftsUndecidable')}</p>
      {mine && <pre className={NOTICE_TEXT}>{mine}</pre>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !mine} onClick={onCopy} className={PRIMARY_BUTTON}>{t(COPY_ACTION)}</button>
        <button type="button" disabled={busy} onClick={onTakeStored}
          className={SECONDARY_BUTTON}>
          {t(ACCEPT_REMOTE)}
        </button>
      </div>
    </div>
  );
}
