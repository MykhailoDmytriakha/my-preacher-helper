'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import FormDialog from '@/components/ui/FormDialog';
import { PageSpinner } from '@/components/ui/PageSpinner';
import { useClipboard } from '@/hooks/useClipboard';
import { getCookieLanguage } from '@/services/userSettings.service';
import { answerWithin } from '@/utils/deviceStorage';
import { fieldLabel } from '@/utils/storedFieldLabel';
import { DEFAULT_LANGUAGE } from '@locales/constants';
import { i18n } from '@locales/i18n';

import { BOOKKEEPING, fingerprint, reviewOf, type Change, type ChangeKind, type ChangeReader, type Review } from './legacyCopyChanges';
import {
  ARCHIVED_COLLECTIONS, compareLegacyCopy, listLegacyQueryCopies, preserveLegacyQueryCache, removeLegacyCopies, retireLegacyEchoes,
  type LegacyCopyComparison, type LegacyQueryCopy, type ServerCopyReader,
} from './legacyQueryRecovery.client';
import { createIndexedDbSnapshots } from './snapshots.client';


/** Reads the server copy the engine already holds on this device — no request leaves the browser. */
function engineServerCopies(owner: string): ServerCopyReader {
  const snapshots = createIndexedDbSnapshots();
  return async (collection, id) => {
    const snapshot = await snapshots.read(owner, { collection, id });
    return snapshot === undefined ? undefined : snapshot.value;
  };
}
/** Documents the engine has not read yet are compared again later, a bounded number of times. */
const ECHO_RETRY_MS = 30_000;
const ECHO_RETRIES = 5;
/** A wait shorter than this is part of an ordinary start and shows nothing; a longer one shows the start spinner. */
const SLOW_START_MS = 400;

/** The language the device's stored choice is shown in: itself, its base ('ru-RU' → 'ru'), or the default. */
function storedLanguageShown(): string {
  const stored = getCookieLanguage();
  return [stored, stored.split('-')[0]].find(code => i18n.hasResourceBundle(code, 'translation')) ?? DEFAULT_LANGUAGE;
}

/** Mount before React Query: even expired caches must be archived before its restore can remove them. */
export function LegacyQueryMigrationGate({ enabled, children }: { enabled: (collection: string) => boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'pending' | 'ready' | 'failed'>('pending');
  const [lateFailure, setLateFailure] = useState(false);
  const [slowStart, setSlowStart] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    let active = true;
    setState('pending');
    setLateFailure(false);
    // Silent device storage must not hold the whole app on this notice
    // (BUG-20260927-engine-open-hangs-on-silent-device-storage). After the threshold the app goes
    // on while the archive keeps running: its read of the old cache was issued first, and the
    // query persister writes nothing over the old cache until the archive is done. An archive that
    // fails after that is said above the app, with Retry, instead of silently keeping writes off.
    const preserving = preserveLegacyQueryCache(enabled);
    void answerWithin(preserving).then(result => {
      if (!active) return;
      setState('ready');
      if (!result.answered) preserving.catch(() => { if (active) setLateFailure(true); });
    }, () => { if (active) setState('failed'); });
    return () => { active = false; };
  }, [enabled, attempt]);
  useEffect(() => {
    if (state !== 'pending') return;
    const timer = setTimeout(() => setSlowStart(true), SLOW_START_MS);
    return () => { clearTimeout(timer); setSlowStart(false); };
  }, [state]);
  const retryLate = () => {
    setLateFailure(false);
    preserveLegacyQueryCache(enabled).catch(() => { if (mounted.current) setLateFailure(true); });
  };
  if (state === 'ready') return <>
    {lateFailure && <div role="alert" className="m-4 rounded-xl border p-4">
      <p>{t('legacyRecovery.preservationFailed')}</p>
      <button type="button" className="mt-3 rounded border px-3 py-2" onClick={retryLate}>{t('dataSync.retry')}</button>
    </div>}
    {children}
  </>;
  // The wait is part of every start: a short one shows nothing, a long one the start spinner — never a
  // notice of its own (BUG-20261004-reload-preserving-copies-flash). "Preserving local copies…" stood in
  // place of every page on every load, in English, as the server and the language setup below this gate
  // render it. A failure is the one thing to say, in the device's stored language, not applied here yet.
  if (state === 'pending') return slowStart ? <PageSpinner /> : null;
  const lng = storedLanguageShown();
  return <div role="alert" lang={lng} className="m-4 rounded-xl border p-4">
    <p>{i18n.t('legacyRecovery.preservationFailed', { lng })}</p>
    <button type="button" className="mt-3 rounded border px-3 py-2" onClick={() => setAttempt(value => value + 1)}>{i18n.t('dataSync.retry', { lng })}</button>
  </div>;
}

// Every archived collection is shown by name, so each one has a label in legacyRecovery.collection.
const NAMED_COLLECTIONS = new Set(ARCHIVED_COLLECTIONS);

/** Bookkeeping never differs in words the person wrote; sorted keys keep a copy readable. */
const forDisplay = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(forDisplay);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => !BOOKKEEPING.has(key))
    .map(key => [key, forDisplay((value as Record<string, unknown>)[key])]));
};

/** Choices named like references: which AI provider and model the person picked is theirs to see. */
const CHOICES = new Set(['providerId', 'modelId', 'preferredProviderId', 'preferredModelId']);
/**
 * Who a record belongs to and what it points at are never the person's words (every such field in
 * models.ts holds a generated id): a nested value reads without them. Inside a list item that leaves
 * or arrives they go with the item, unreported; anywhere else a difference in them is named.
 */
const isReference = (key: string) => !CHOICES.has(key)
  && (key === 'id' || key === 'userId' || key === 'uid' || key === 'ownerId' || /[a-z]Ids?$/.test(key));
/** Parts of a list item that say where or when it sits, not what it says. */
const ITEM_PLACEMENT = new Set(['position', 'isLocked']);
/** A value with no words in it: a mark, a number, a flag — or a list of those. */
const isToken = (value: unknown): boolean => value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean'
  || (typeof value === 'string' && !/\s/.test(value)) || (Array.isArray(value) && value.every(isToken));
/**
 * The one rule for what a copy's lines leave out: a reference, or a list item's placement, that holds
 * no words. Words are shown under any key; whatever this leaves out is what `unseen` reports.
 */
const leftOut = (key: string, value: unknown, inItem: boolean) => (isReference(key) || (inItem && ITEM_PLACEMENT.has(key))) && isToken(value);
/** The parts a list item is named by, in the order they are tried. */
const ITEM_NAMES = ['text', 'title', 'name', 'question', 'decision', 'answerText'];

const ACTION_FAILED = 'legacyRecovery.actionFailed';
const BUTTON = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-60 dark:focus-visible:ring-offset-gray-900';
const ACCEPT = `${BUTTON} bg-green-600 text-white hover:bg-green-700 focus-visible:ring-green-500`;
const OUTLINE = `${BUTTON} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 focus-visible:ring-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700`;
const DANGER = `${BUTTON} bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500`;
const DARK = `${BUTTON} bg-gray-900 text-white hover:bg-gray-800 focus-visible:ring-gray-500 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white`;
const QUIET = 'min-h-[40px] rounded-lg px-3 text-sm text-gray-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:text-gray-300';
const RAW = 'mt-1 whitespace-pre-wrap break-words rounded-lg bg-gray-100 px-2 py-1 font-mono text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-200';
const WRAP = 'min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]';

/** How each kind of change looks: the device's side struck in red, the app's side in green. */
const KIND: Record<ChangeKind, { sign: string; label: string; frame: string; head: string }> = {
  added: { sign: '+', label: 'legacyRecovery.kindAdded', frame: 'border-green-200 dark:border-green-500/30', head: 'bg-green-50 text-green-800 dark:bg-green-500/10 dark:text-green-200' },
  removed: { sign: '−', label: 'legacyRecovery.kindRemoved', frame: 'border-rose-200 dark:border-rose-500/30', head: 'bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200' },
  replaced: { sign: '±', label: 'legacyRecovery.kindReplaced', frame: 'border-gray-200 dark:border-gray-600', head: 'bg-gray-100 text-gray-700 dark:bg-gray-700/60 dark:text-gray-100' },
};

interface ArchiveView { owner: string; copies: LegacyQueryCopy[]; comparisons: Record<string, LegacyCopyComparison>; failed: boolean }

/**
 * A decision belongs to the comparison it was made on: a copy replaced under its id, or a server
 * copy that changed meanwhile, starts undecided — no acceptance moves to a change it was not made on.
 */
const decisionKey = (copy: LegacyQueryCopy, comparison: LegacyCopyComparison | undefined) =>
  `${copy.id}\n${copy.raw}\n${comparison?.kind === 'row' && comparison.rows ? fingerprint(comparison.rows.server) : ''}`;
const changeKeys = (review: Review | undefined) => (review?.fields ?? []).flatMap(field => field.rows.flatMap(row => ('change' in row ? [row.change.key] : [])));

/**
 * COPIES FROM THE PREVIOUS VERSION, REVIEWED AS CHANGES.
 *
 * A thin strip says how many records on this device differ from the app; it opens the review.
 * Each copy is read against the server copy the engine holds on this device and laid out as
 * changes — added, removed, replaced — the device's side to go, the app's to stay. Every change
 * is accepted on its own; accepting decides nothing by itself and closing the review removes
 * nothing. A copy leaves the device only when the person removes it: one copy whose changes are all
 * decided, with its raw data a press away, or — once everything is decided — every copy holding
 * nothing the review could not show, at once. "Copy" takes the device's words for the person to
 * paste; nothing is written back. A copy whose difference cannot all be shown as changes, and any
 * copy with nothing to compare — an unsent action, a document not read here yet or deleted on the
 * server, an unreadable copy — shows what it holds and asks before it goes. "Accept all" asks
 * first: no date proves whose words are newer.
 */
export function LegacyQueryCopies({ owner }: { owner: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<ArchiveView | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  // Accepted changes by the comparison they were made on; each key is the change's own content.
  const [accepted, setAccepted] = useState<Record<string, readonly string[]>>({});
  // The copies the question was asked about: a copy archived meanwhile is not removed with them.
  const [confirmAll, setConfirmAll] = useState<readonly LegacyQueryCopy[] | null>(null);
  const { copyToClipboard } = useClipboard({
    onSuccess: () => { toast.success(t('freshness.copiedToast')); },
    onError: () => { toast.error(t('common.saveError')); },
  });
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reader = engineServerCopies(owner);
    // Refreshes can overlap: only the latest one started may publish what it read.
    let latest = 0;
    // Whether the comparison on screen still waits for a server copy the engine had not read.
    let waiting = false;
    const show = async () => {
      const refresh = ++latest;
      const isLatest = () => active && refresh === latest;
      try {
        const copies = await listLegacyQueryCopies(owner);
        const servers = new Map<string, Promise<Record<string, unknown> | null | undefined>>();
        const comparisons: Record<string, LegacyCopyComparison> = {};
        for (const copy of copies) {
          const document = `${copy.collection}/${copy.documentId}`;
          // An unreadable server copy is shown as "nothing to compare with", never as a match.
          if (!servers.has(document)) servers.set(document, reader(copy.collection, copy.documentId).catch(() => undefined));
          // One malformed copy is shown as "nothing to compare with"; it never hides the others.
          try { comparisons[copy.id] = compareLegacyCopy(copy, await servers.get(document)); }
          catch { comparisons[copy.id] = { kind: 'row', server: 'unknown', freshness: 'unknown', deviceVersionAt: null, serverVersionAt: null, differences: [], rows: null }; }
        }
        if (!isLatest()) return;
        waiting = Object.values(comparisons).some(comparison => comparison.server === 'missing');
        setState({ owner, copies, comparisons, failed: false });
      } catch {
        if (isLatest()) setState({ owner, copies: [], comparisons: {}, failed: true });
      }
    };
    // Copies that say exactly what the server says are retired; whatever differs stays shown.
    // A pass that removed nothing still shows the comparison again while the screen waits for a
    // server copy: it may have arrived since, different.
    const retire = (attempt: number) => {
      void retireLegacyEchoes(owner, reader).then(({ retired, undecided }) => {
        if (!active) return;
        if (retired || waiting) void show();
        if (undecided && attempt < ECHO_RETRIES) timer = setTimeout(() => retire(attempt + 1), ECHO_RETRY_MS);
      }, error => { console.error('Previous-version copies could not be compared with the server', error); });
    };
    void show().then(() => { if (active) retire(1); });
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [owner, version]);

  const current = state?.owner === owner ? state : null;
  const formatting = useCopyFormatting();
  const { reader, read } = formatting;
  // Read as changes only while the review is open: the strip needs a count, not the diffs.
  const reviews = useMemo(() => {
    const result: Record<string, Review> = {};
    if (!open) return result;
    for (const copy of current?.copies ?? []) {
      const comparison = current?.comparisons[copy.id];
      if (comparison?.kind !== 'row' || comparison.server !== 'present' || !comparison.rows) continue;
      const review = reviewOf(copy.collection, comparison.rows.device, comparison.rows.server, comparison.differences, reader);
      if (review.fields.length) result[copy.id] = review;
    }
    return result;
  }, [open, current, reader]);
  const markFailed = (failed: boolean) => setState(previous => previous?.owner === owner && previous.failed !== failed ? { ...previous, failed } : previous);

  const settle = async (copies: readonly LegacyQueryCopy[]) => {
    if (busy || !copies.length) return;
    setBusy(true);
    try { await removeLegacyCopies(owner, copies.map(copy => ({ id: copy.id, raw: copy.raw }))); }
    catch (error) {
      console.error('Previous-version copies could not be removed', error);
      toast.error(t('legacyRecovery.removeFailed'));
    } finally {
      setBusy(false);
      setConfirmAll(null);
      setVersion(value => value + 1);
    }
  };
  const keyOf = (copy: LegacyQueryCopy) => decisionKey(copy, current?.comparisons[copy.id]);
  const acceptedOf = (copy: LegacyQueryCopy) => accepted[keyOf(copy)] ?? [];
  const pendingOf = (copy: LegacyQueryCopy) => changeKeys(reviews[copy.id]).filter(key => !acceptedOf(copy).includes(key));
  const decide = (copy: LegacyQueryCopy, key: string, accept: boolean) => setAccepted(previous => {
    const kept = (previous[keyOf(copy)] ?? []).filter(entry => entry !== key);
    return { ...previous, [keyOf(copy)]: accept ? [...kept, key] : kept };
  });
  // Closing removes nothing: decisions wait on screen until the person removes the copies.
  const close = () => {
    if (busy) return;
    setOpen(false);
    setConfirmAll(null);
  };
  const copyText = (lines: readonly string[]) => { void copyToClipboard(lines.join('\n')); };
  const saveFile = (text: string, name: string) => {
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = name; anchor.click();
      markFailed(false);
    } catch { markFailed(true); }
    // Slow devices start the download late; the file must still be there when they do.
    finally { const used = url; if (used) setTimeout(() => URL.revokeObjectURL(used), 40_000); }
  };
  const download = (copy: LegacyQueryCopy) => { if (copy.owner === owner) saveFile(copy.raw, `saved-${copy.collection}-copy.json`); };
  const downloadAll = () => {
    if (!current) return;
    const readable = (raw: string) => { try { return JSON.parse(raw) as unknown; } catch { return raw; } };
    const savedAt = (at: unknown) => typeof at === 'number' && Number.isFinite(at) ? new Date(at).toISOString() : null;
    saveFile(JSON.stringify(current.copies.map(copy => ({ collection: copy.collection, documentId: copy.documentId, title: copy.title,
      savedAt: savedAt(copy.savedAt), content: readable(copy.raw) })), null, 2), 'previous-version-copies.json');
  };

  if (!current) return null;
  if (!current.copies.length) return current.failed ? <p role="alert" className="mb-3 text-sm text-rose-700 dark:text-rose-300">{t(ACTION_FAILED)}</p> : null;
  const count = current.copies.length;
  // What still waits: every change not accepted, and a copy that only an explicit removal settles.
  const left = current.copies.reduce((sum, copy) => {
    const review = reviews[copy.id];
    if (!review) return sum + 1;
    const pending = pendingOf(copy).length;
    return sum + pending + (pending === 0 && review.hidden.length ? 1 : 0);
  }, 0);
  const footer = confirmAll ? (
    <div role="alert" className="space-y-3">
      <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-200">{t('legacyRecovery.acceptAllChangesConfirm')}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={busy} onClick={downloadAll} className={OUTLINE}>{t('legacyRecovery.downloadAll')}</button>
        <button type="button" disabled={busy} onClick={() => setConfirmAll(null)} className={OUTLINE}>{t('common.cancel')}</button>
        <button type="button" disabled={busy} onClick={() => { void settle(confirmAll); }} className={ACCEPT}>{t('legacyRecovery.acceptAllChangesYes')}</button>
      </div>
    </div>
  ) : left ? (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
      <button type="button" disabled={busy} onClick={downloadAll} className={OUTLINE}>{t('legacyRecovery.downloadAll')}</button>
      <button type="button" disabled={busy} onClick={() => setConfirmAll(current.copies)} className={OUTLINE}>{t('legacyRecovery.acceptAllChanges')}</button>
    </div>
  ) : (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-green-700 dark:text-green-300">{t('legacyRecovery.done')}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={busy} onClick={close} className={OUTLINE}>{t('common.close')}</button>
        {/* Nothing is left to decide here: every copy is a review with all its changes accepted and nothing unshown. */}
        <button type="button" disabled={busy} onClick={() => { void settle(current.copies); }} className={DARK}>{t('legacyRecovery.removeDecided')}</button>
      </div>
    </div>
  );
  return (
    <>
      {current.failed && <p role="alert" className="mb-2 text-sm text-rose-700 dark:text-rose-300">{t(ACTION_FAILED)}</p>}
      <button type="button" onClick={() => setOpen(true)}
        className="mb-3 flex min-h-[44px] w-full items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 text-left text-sm text-orange-900 transition-colors hover:bg-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-100 dark:hover:bg-orange-500/20">
        <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-600 text-xs font-extrabold text-white">!</span>
        <span className="min-w-0 flex-1 py-2 leading-snug sm:truncate sm:py-0">{t('legacyRecovery.strip', { count })}</span>
        <span className="shrink-0 font-semibold text-orange-800 dark:text-orange-200">{t('legacyRecovery.review')} ›</span>
      </button>
      {open && (
        <FormDialog title={t('legacyRecovery.sheetTitle')} description={left ? t('legacyRecovery.leftToDecide', { count: left }) : t('legacyRecovery.allDecided')}
          size="standard" showCloseButton closeDisabled={busy} onClose={close} footer={footer}>
          <div className="space-y-2">
            <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{t('legacyRecovery.intro')}</p>
            <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
              {(['added', 'removed', 'replaced'] as const).map(kind => (
                <span key={kind} className={`rounded-full px-2.5 py-0.5 ${KIND[kind].head}`}>{KIND[kind].sign} {t(KIND[kind].label)}</span>
              ))}
            </div>
            <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">{t('legacyRecovery.acceptHint')} {t('legacyRecovery.copyHint')}</p>
          </div>
          {current.copies.map(copy => reviews[copy.id] ? (
            <ReviewCard key={copy.id} copy={copy} comparison={current.comparisons[copy.id]} review={reviews[copy.id]} accepted={acceptedOf(copy)}
              busy={busy} formatting={formatting} onDecide={(key, accept) => decide(copy, key, accept)} onCopy={copyText}
              onRemove={() => { void settle([copy]); }} onDownload={() => download(copy)} />
          ) : (
            <CopyCard key={copy.id} copy={copy} comparison={current.comparisons[copy.id]} busy={busy} formatting={formatting}
              onRemove={() => { void settle([copy]); }} onCopy={() => copyText(read(copy))} onDownload={() => download(copy)} />
          ))}
        </FormDialog>
      )}
    </>
  );
}

type Formatting = ReturnType<typeof useCopyFormatting>;

/**
 * How a copy's dates, field names and values read to the person — one lens for the review, the
 * cards and the clipboard. It shows every part that holds words, under any key; only references
 * (ids) and a list item's placement (where it sits, whether it is locked) holding no words stay
 * out (`leftOut`), and `unseen` returns exactly those parts so a difference in them is named.
 */
function useCopyFormatting() {
  const { t, i18n } = useTranslation();
  return useMemo(() => {
    const dateFormat = new Intl.DateTimeFormat(i18n.language || undefined, {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const when = (iso: string | null) => iso ? dateFormat.format(new Date(iso)) : t('legacyRecovery.noDate');
    // A calendar day is the same day wherever it is read; a moment reads in local time.
    const dayFormat = new Intl.DateTimeFormat(i18n.language || undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const asDate = (value: string): string => {
      const at = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : null;
      if (!at || Number.isNaN(at.getTime())) return value;
      return /T/.test(value) ? dateFormat.format(at) : dayFormat.format(at);
    };
    const fieldName = (field: string) => fieldLabel(t, field);
    const nameOf = (entry: Record<string, unknown>): string | null => {
      for (const key of ITEM_NAMES) {
        const value = entry[key];
        if (typeof value === 'string' && value.trim()) return key;
      }
      return null;
    };
    /** Fields under their names, each value in full; `name` is shown elsewhere, `inItem` says a list item is read. */
    const labelled = (value: Record<string, unknown>, inItem: boolean, name: string | null = null): string[] => {
      const shown = forDisplay(value) as Record<string, unknown>;
      return Object.keys(shown).filter(key => key !== name && !leftOut(key, shown[key], inItem)).flatMap(key => {
        const inner = lines(key, shown[key]);
        if (!inner.length) return [];
        return inner.length === 1 ? [`${fieldName(key)}: ${inner[0]}`] : [`${fieldName(key)}:`, ...inner.map(line => `  ${line}`)];
      });
    };
    /** A list item in full: the words it is named by, then every other part that holds words. */
    const entry = (value: Record<string, unknown>): string[] => {
      const name = nameOf(value);
      const rest = labelled(value, true, name);
      return name ? [value[name] as string, ...rest] : rest;
    };
    /** A value as the lines it reads in: words as written, a choice by its name, nested values in full. */
    const lines = (field: string, value: unknown): string[] => {
      if (value === undefined || value === null) return [];
      if (typeof value === 'boolean') return [t(value ? 'legacyRecovery.valueOn' : 'legacyRecovery.valueOff')];
      if (typeof value === 'number') return [String(value)];
      if (typeof value === 'string') {
        if (field === 'firstDayOfWeek' && (value === 'sunday' || value === 'monday')) return [t(`settings.firstDayOfWeek.${value}`)];
        if (field === 'date') return [asDate(value)];
        return value.trim() ? value.split('\n') : [];
      }
      if (Array.isArray(value)) return value.flatMap(item => {
        const inner = item && typeof item === 'object' && !Array.isArray(item) ? entry(item as Record<string, unknown>) : lines(field, item);
        return inner.length ? [`• ${inner[0]}`, ...inner.slice(1).map(line => `  ${line}`)] : [];
      });
      return labelled(value as Record<string, unknown>, false);
    };
    /** A list item by the words the person knows it by. */
    const item = (value: Record<string, unknown>): string => {
      const name = nameOf(value);
      return name ? value[name] as string : entry(value).join(' · ');
    };
    /**
     * What `lines` and `entry` leave out of a value, by the same rule. Only a list item's own id is
     * not reported: it is what the item is matched by, never a difference of its own.
     */
    const unseen = (value: unknown, inList = false): unknown => {
      if (Array.isArray(value)) {
        const inner = value.map(part => unseen(part, true));
        return inner.some(part => part !== undefined) ? inner : undefined;
      }
      if (!value || typeof value !== 'object') return undefined;
      const parts = Object.entries(forDisplay(value) as Record<string, unknown>).flatMap(([key, part]): [string, unknown][] => {
        if (leftOut(key, part, true)) return (inList && key === 'id') || part === undefined || part === null ? [] : [[key, part]];
        const inner = unseen(part);
        return inner === undefined ? [] : [[key, inner]];
      });
      return parts.length ? Object.fromEntries(parts) : undefined;
    };
    const reader: ChangeReader = { item, entry, value: lines, label: fieldName, unseen: value => unseen(value) };
    /** What a copy holds, readable: what an operation would have written, else the whole copy. */
    const read = (copy: LegacyQueryCopy): string[] => {
      try {
        const parsed = JSON.parse(copy.raw) as { mutationKey?: unknown; state?: { variables?: unknown } };
        if (!('mutationKey' in parsed)) return lines('', parsed);
        const variables = parsed.state?.variables;
        const fields = variables && typeof variables === 'object' ? variables as Record<string, unknown> : {};
        const payload = fields.input ?? fields.updates ?? variables;
        return lines('', payload ?? parsed);
      } catch { return [copy.raw]; }
    };
    return { when, fieldName, reader, read };
  }, [t, i18n.language]);
}

/** A copy's name and where its two versions come from, the same for every kind of card. */
function CardHead({ copy, comparison, eyebrow, formatting }: { copy: LegacyQueryCopy; comparison: LegacyCopyComparison | undefined; eyebrow?: string; formatting: Formatting }) {
  const { t } = useTranslation();
  const kind = NAMED_COLLECTIONS.has(copy.collection) ? t(`legacyRecovery.collection.${copy.collection}`) : copy.collection;
  const title = copy.collection === 'users' ? kind : copy.title && copy.title !== copy.documentId ? copy.title : t('legacyRecovery.untitled');
  const top = [copy.collection === 'users' ? null : kind, eyebrow].filter(Boolean).join(' · ');
  return (
    <header className="px-1">
      {top && <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{top}</p>}
      <h3 className="break-words text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
        {t('legacyRecovery.onDevice')}: {t('legacyRecovery.versionFrom', { date: formatting.when(comparison?.deviceVersionAt ?? null) })}
        {comparison?.server === 'present' && comparison.serverVersionAt && <> · {t('legacyRecovery.inApp')}: {t('legacyRecovery.changedAt', { date: formatting.when(comparison.serverVersionAt) })}</>}
      </p>
    </header>
  );
}

/** Unchanged lines between changes, folded when there are many. */
function Context({ lines }: { lines: readonly string[] }) {
  const { t } = useTranslation();
  const shown = lines.length > 3 ? [lines[0], null, lines[lines.length - 1]] : lines;
  return (
    <div className="space-y-1 px-1 text-[15px] leading-relaxed text-gray-500 dark:text-gray-400">
      {shown.map((line, index) => line === null
        ? <p key={index} className="text-xs">{t('legacyRecovery.unchangedLines', { count: lines.length - 2 })}</p>
        : <p key={index} className={WRAP}>{line}</p>)}
    </div>
  );
}

/** One change: what only this device held struck in red, what the app holds in green; its own decision below. */
function ChangeBlock({ change, accepted, onDecide, onCopy }: { change: Change; accepted: boolean; onDecide: (accept: boolean) => void; onCopy: () => void }) {
  const { t } = useTranslation();
  const kind = KIND[change.kind];
  const inline = change.kind === 'replaced' && change.device.length === 1 && change.server.length === 1
    && change.device[0].length + change.server[0].length < 48;
  // Colour and strike-through are not the only signs: a screen reader hears which side is which.
  const deviceText = <span className={`${WRAP} text-rose-700 line-through decoration-rose-500 dark:text-rose-300`}><span className="sr-only">{t('legacyRecovery.onDevice')}: </span>{change.device.join('\n')}</span>;
  const serverText = <span className={`${WRAP} text-green-800 dark:text-green-300`}><span className="sr-only">{t('legacyRecovery.inApp')}: </span>{change.server.join('\n')}</span>;
  if (accepted) {
    return (
      <div className="space-y-1">
        {change.kind !== 'removed' && <p className={`${WRAP} px-1 text-[15px] leading-relaxed text-gray-800 dark:text-gray-100`}>{change.server.join('\n')}</p>}
        <div role="status" className="flex items-center justify-between gap-2 rounded-xl bg-gray-100 py-1 pl-3 pr-1 text-sm text-gray-600 dark:bg-gray-900/50 dark:text-gray-300">
          <span>✓ {t('legacyRecovery.accepted')}</span>
          <button type="button" onClick={() => onDecide(false)} className={QUIET}>{t('legacyRecovery.undo')}</button>
        </div>
      </div>
    );
  }
  return (
    <div role="group" aria-label={t(kind.label)} className={`overflow-hidden rounded-xl border bg-white dark:bg-gray-800 ${kind.frame}`}>
      <p className={`px-3 py-1.5 text-xs font-semibold ${kind.head}`}>{kind.sign} {t(kind.label)}</p>
      {change.subject && <p className={`${WRAP} px-3 pt-2 text-xs font-medium text-gray-500 dark:text-gray-400`}>{change.subject}</p>}
      <div className="space-y-1 px-3 pt-2 text-[15px] leading-relaxed">
        {inline ? (
          <p className="flex min-w-0 flex-wrap items-center gap-x-2">{deviceText}<span aria-hidden="true" className="text-gray-400">→</span><span className="min-w-0 font-semibold">{serverText}</span></p>
        ) : (
          <>
            {change.device.length > 0 && <p className="min-w-0">{deviceText}</p>}
            {change.server.length > 0 && <p className="min-w-0">{serverText}</p>}
          </>
        )}
      </div>
      <div className={`gap-2 p-3 ${change.device.length ? 'grid grid-cols-2 sm:flex sm:justify-end' : 'flex justify-end'}`}>
        {change.device.length > 0 && <button type="button" onClick={onCopy} className={OUTLINE}>{t('legacyRecovery.copyChange')}</button>}
        <button type="button" onClick={() => onDecide(true)} className={`${ACCEPT} ${change.device.length ? '' : 'w-full sm:w-auto'}`}>✓ {t('legacyRecovery.accept')}</button>
      </div>
    </div>
  );
}

/**
 * Removing a copy by hand: what it holds stays a press away in its raw form, and the question is
 * bound to the content it was asked about — a copy filed under the same id meanwhile closes the
 * question instead of leaving with words the person never saw.
 */
function RemoveCopy({ copy, busy, onRemove, onDownload, onCopy, removable = true }: {
  copy: LegacyQueryCopy; busy: boolean; onRemove: () => void; onDownload: () => void; onCopy?: () => void; removable?: boolean;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState<string | null>(null);
  return (
    <>
      <details className="px-1">
        <summary className="cursor-pointer text-xs text-gray-500 underline-offset-2 hover:underline dark:text-gray-400">{t('legacyRecovery.rawData')}</summary>
        <pre className={RAW}>{copy.raw}</pre>
      </details>
      {asking === copy.raw ? (
        <div role="alert" className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
          <p className="text-sm text-rose-900 dark:text-rose-100">{t('legacyRecovery.removeCopyConfirm')}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={busy} onClick={onDownload} className={OUTLINE}>{t('legacyRecovery.export')}</button>
            <button type="button" disabled={busy} onClick={() => setAsking(null)} className={OUTLINE}>{t('common.cancel')}</button>
            <button type="button" disabled={busy} onClick={onRemove} className={DANGER}>{t('legacyRecovery.removeCopyYes')}</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          {onCopy && <button type="button" disabled={busy} onClick={onCopy} className={OUTLINE}>{t('legacyRecovery.copyChange')}</button>}
          <button type="button" disabled={busy} onClick={onDownload} className={OUTLINE}>{t('legacyRecovery.export')}</button>
          {removable && <button type="button" disabled={busy} onClick={() => setAsking(copy.raw)} className={OUTLINE}>{t('legacyRecovery.removeCopy')}</button>}
        </div>
      )}
    </>
  );
}

/**
 * A copy laid out as changes, field by field, each accepted on its own. Once every change is
 * accepted the copy can be removed by hand; its raw data and its file are a press away from the
 * start. When part of its difference shows as no change (a list only reordered, values that read
 * alike, a reference left out), the card says so.
 */
function ReviewCard({ copy, comparison, review, accepted, busy, formatting, onDecide, onCopy, onRemove, onDownload }: {
  copy: LegacyQueryCopy; comparison: LegacyCopyComparison | undefined; review: Review; accepted: readonly string[]; busy: boolean;
  formatting: Formatting; onDecide: (key: string, accept: boolean) => void; onCopy: (lines: readonly string[]) => void;
  onRemove: () => void; onDownload: () => void;
}) {
  const { t } = useTranslation();
  const keys = changeKeys(review);
  const allAccepted = keys.every(key => accepted.includes(key));
  return (
    <article className="space-y-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <CardHead copy={copy} comparison={comparison} eyebrow={t('legacyRecovery.changes', { count: keys.length })} formatting={formatting} />
      {review.fields.map(field => (
        <section key={field.field} className="space-y-2">
          <p className="px-1 text-xs font-medium text-gray-500 dark:text-gray-400">{formatting.fieldName(field.field)}</p>
          {field.rows.map((row, index) => 'context' in row
            ? <Context key={`context-${index}`} lines={row.context} />
            : <ChangeBlock key={row.change.key} change={row.change} accepted={accepted.includes(row.change.key)}
              onDecide={accept => onDecide(row.change.key, accept)}
              onCopy={() => onCopy(row.change.subject ? [row.change.subject, ...row.change.device] : row.change.device)} />)}
        </section>
      ))}
      {review.hidden.length > 0 && (
        <p className="px-1 text-sm text-gray-700 dark:text-gray-300">
          {t('legacyRecovery.partlyHidden', { fields: review.hidden.map(formatting.fieldName).join(', ') })}
        </p>
      )}
      {/* What the copy holds is a press away from the start; removing it waits until every change is accepted. */}
      <RemoveCopy copy={copy} busy={busy} onRemove={onRemove} onDownload={onDownload} removable={allAccepted} />
    </article>
  );
}

/** A copy with nothing to review as changes: what it holds, readable, on screen, and a question before it goes. */
function CopyCard({ copy, comparison, busy, formatting, onRemove, onCopy, onDownload }: {
  copy: LegacyQueryCopy; comparison: LegacyCopyComparison | undefined; busy: boolean; formatting: Formatting;
  onRemove: () => void; onCopy: () => void; onDownload: () => void;
}) {
  const { t } = useTranslation();
  const note = comparison?.kind === 'operation' ? 'legacyRecovery.operationNote'
    : comparison?.kind === 'unreadable' ? 'legacyRecovery.unreadableNote'
      : comparison?.server === 'deleted' ? 'legacyRecovery.serverDeleted'
        : comparison?.server === 'unknown' ? 'legacyRecovery.serverUnknown'
          // Read side by side, nothing differs as a change the review can show.
          : comparison?.server === 'present' ? 'legacyRecovery.noVisibleDifference' : 'legacyRecovery.serverMissing';
  const content = formatting.read(copy);
  return (
    <article className="space-y-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <CardHead copy={copy} comparison={comparison} formatting={formatting} />
      <p className="px-1 text-sm text-gray-700 dark:text-gray-300">{t(note)}</p>
      {content.length > 0 && <div className={`${WRAP} rounded-xl bg-gray-50 px-3 py-2 text-[15px] leading-relaxed text-gray-800 dark:bg-gray-900/50 dark:text-gray-100`}>{content.join('\n')}</div>}
      <RemoveCopy copy={copy} busy={busy} onRemove={onRemove} onDownload={onDownload} onCopy={onCopy} />
    </article>
  );
}
