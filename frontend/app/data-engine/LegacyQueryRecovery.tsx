'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Chip } from '@/components/ui/Chip';
import { useClipboard } from '@/hooks/useClipboard';

import {
  compareLegacyCopy, listLegacyQueryCopies, preserveLegacyQueryCache, removeLegacyCopies, retireLegacyEchoes,
  type CopyFreshness, type LegacyCopyComparison, type LegacyQueryCopy, type ServerCopyReader,
} from './legacyQueryRecovery.client';
import { createIndexedDbSnapshots } from './snapshots.client';

import type { ChipTone } from '@/utils/themeColors';

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

/** Mount before React Query: even expired caches must be archived before its restore can remove them. */
export function LegacyQueryMigrationGate({ enabled, children }: { enabled: (collection: string) => boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'pending' | 'ready' | 'failed'>('pending');
  useEffect(() => {
    let active = true;
    setState('pending');
    void preserveLegacyQueryCache(enabled).then(() => { if (active) setState('ready'); }, () => { if (active) setState('failed'); });
    return () => { active = false; };
  }, [enabled, attempt]);
  if (state === 'ready') return <>{children}</>;
  return <div role={state === 'failed' ? 'alert' : 'status'} className="m-4 rounded-xl border p-4">
    {/* Rendered before the language is detected on the server, so the text differs by design. */}
    <p suppressHydrationWarning>{t(state === 'failed' ? 'legacyRecovery.preservationFailed' : 'legacyRecovery.preserving')}</p>
    {state === 'failed' && <button type="button" className="mt-3 rounded border px-3 py-2" onClick={() => setAttempt(value => value + 1)}>{t('dataSync.retry')}</button>}
  </div>;
}

/** Fields whose name the person should read in their own words; any other field shows as stored. */
const NAMED_FIELDS = new Set(['title', 'verse', 'description', 'date', 'items', 'sermonIds', 'seriesKind', 'thoughts',
  'structure', 'thoughtsBySection', 'plan', 'draft', 'outline', 'topics', 'status', 'meetingDates', 'preachDates', 'tags', 'isPreached']);
const NAMED_COLLECTIONS = new Set(['councils', 'groups', 'series', 'sermons']);

/** Bookkeeping never differs in words the person wrote; sorted keys keep both sides line-aligned. */
const HIDDEN_KEYS = new Set(['updatedAt', 'createdAt', 'rev', '_dataEngine', '_dataEngineOwner']);
const forDisplay = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(forDisplay);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => !HIDDEN_KEYS.has(key))
    .map(key => [key, forDisplay((value as Record<string, unknown>)[key])]));
};

const ACTION_FAILED = 'legacyRecovery.actionFailed';
const BUTTON = 'rounded-lg px-3 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-60';
const PRIMARY = `${BUTTON} bg-amber-600 text-white hover:bg-amber-700`;
const SECONDARY = `${BUTTON} border border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20`;
const QUIET = `${BUTTON} px-2 text-amber-900/80 underline-offset-2 hover:underline dark:text-amber-200/80`;
const DANGER = `${BUTTON} bg-rose-600 text-white hover:bg-rose-700`;
const CONTENT = 'max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/70 px-2 py-1 font-mono text-xs text-gray-900 dark:bg-black/20 dark:text-gray-100';

interface ArchiveView { owner: string; copies: LegacyQueryCopy[]; comparisons: Record<string, LegacyCopyComparison>; failed: boolean }

/**
 * COPIES FROM THE PREVIOUS VERSION, LAID OUT FOR A DECISION.
 *
 * Each remaining copy is shown against the server copy the engine holds on this device: which
 * side changed last, and only the fields that differ — the device's line to go, the server's to
 * stay, as in a diff. No copy leaves without a decision made while its difference or a question
 * is on screen: a copy with a visible difference can keep the server version in one press; any
 * other copy, and "Accept everything from the server", ask first — no date proves whose words are newer.
 */
export function LegacyQueryCopies({ owner }: { owner: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<ArchiveView | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  // The copies the question was asked about: a copy archived meanwhile is not removed with them.
  const [confirmAll, setConfirmAll] = useState<readonly LegacyQueryCopy[] | null>(null);
  // Rows and line diffs render only once opened: a closed <details> still renders its children.
  const [listOpen, setListOpen] = useState(false);
  const { copyToClipboard } = useClipboard({
    onSuccess: () => { toast.success(t('freshness.copiedToast')); },
    onError: () => { toast.error(t('common.saveError')); },
  });
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reader = engineServerCopies(owner);
    const show = async () => {
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
          catch { comparisons[copy.id] = { kind: 'row', server: 'unknown', freshness: 'unknown', deviceVersionAt: null, serverVersionAt: null, differences: [] }; }
        }
        if (active) setState({ owner, copies, comparisons, failed: false });
      } catch {
        if (active) setState({ owner, copies: [], comparisons: {}, failed: true });
      }
    };
    // Copies that say exactly what the server says are retired; whatever differs stays shown.
    const retire = (attempt: number) => {
      void retireLegacyEchoes(owner, reader).then(({ retired, undecided }) => {
        if (!active) return;
        if (retired) void show();
        if (undecided && attempt < ECHO_RETRIES) timer = setTimeout(() => retire(attempt + 1), ECHO_RETRY_MS);
      }, error => { console.error('Previous-version copies could not be compared with the server', error); });
    };
    void show().then(() => { if (active) retire(1); });
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [owner, version]);

  const current = state?.owner === owner ? state : null;
  const { fieldName, shown } = useCopyFormatting();
  const markFailed = (failed: boolean) => setState(previous => previous?.owner === owner && previous.failed !== failed ? { ...previous, failed } : previous);

  const settle = async (copies: readonly LegacyQueryCopy[]) => {
    if (busy) return;
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
  // Every remaining copy differs from the server, and no date proves whose words are newer:
  // accepting the server version for all of them is always the person's explicit second step.
  const acceptAll = () => { if (current) setConfirmAll(current.copies); };
  const copyFromDevice = (copy: LegacyQueryCopy) => {
    const differences = current?.comparisons[copy.id]?.differences ?? [];
    void copyToClipboard(differences.length
      ? differences.map(entry => `${fieldName(entry.field)}: ${shown(entry.device)}`).join('\n\n')
      : copy.raw);
  };
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
  return (
    <>
    {current.failed && <p role="alert" className="mb-2 text-sm text-rose-700 dark:text-rose-300">{t(ACTION_FAILED)}</p>}
    <section aria-labelledby="legacy-copies-title" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="legacy-copies-title" className="font-medium text-amber-950 dark:text-amber-100">{t('legacyRecovery.cacheTitle', { count })}</h2>
          <p className="mt-0.5 text-amber-900/80 dark:text-amber-100/70">{t('legacyRecovery.cacheBody')}</p>
        </div>
        <button type="button" disabled={busy || confirmAll !== null} onClick={acceptAll} className={`${PRIMARY} w-full shrink-0 sm:w-auto`}>{t('legacyRecovery.acceptAllServer')}</button>
      </div>
      {confirmAll && (
        <div role="alert" className="mx-4 mb-3 rounded-lg border border-rose-300 bg-white/70 px-3 py-2 dark:border-rose-500/40 dark:bg-black/20">
          <p className="text-rose-900 dark:text-rose-100">{t('legacyRecovery.acceptAllConfirm')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={downloadAll} className={SECONDARY}>{t('legacyRecovery.downloadAll')}</button>
            <button type="button" disabled={busy} onClick={() => { void settle(confirmAll); }} className={DANGER}>{t('legacyRecovery.acceptAllYes')}</button>
            <button type="button" disabled={busy} onClick={() => setConfirmAll(null)} className={QUIET}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
      <details open={listOpen} className="border-t border-amber-200 dark:border-amber-500/30">
        <summary onClick={event => { event.preventDefault(); setListOpen(value => !value); }} className="cursor-pointer px-4 py-2 font-medium text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 dark:text-amber-100">
          {t('legacyRecovery.showDifferences', { count })}
        </summary>
        {listOpen && <ul className="divide-y divide-amber-200 dark:divide-amber-500/20">
          {current.copies.map(copy => (
            <CopyRow key={copy.id} copy={copy} comparison={current.comparisons[copy.id]} busy={busy}
              onRemove={() => { void settle([copy]); }} onCopy={() => copyFromDevice(copy)} onDownload={() => download(copy)} />
          ))}
        </ul>}
      </details>
    </section>
    </>
  );
}

/** How a copy's dates, field names and values read to the person — one lens for the row and the clipboard. */
function useCopyFormatting() {
  const { t, i18n } = useTranslation();
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(i18n.language || undefined, {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }), [i18n.language]);
  const when = (iso: string | null) => iso ? dateFormat.format(new Date(iso)) : t('legacyRecovery.noDate');
  const fieldName = (field: string) => NAMED_FIELDS.has(field) ? t(`legacyRecovery.field.${field}`) : field;
  const shown = (value: unknown): string => {
    if (value === undefined || value === null) return t('legacyRecovery.absent');
    if (typeof value === 'string') return value.trim() ? value : t('legacyRecovery.empty');
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value) && value.every(item => typeof item === 'string' || typeof item === 'number')) {
      return value.length ? value.join(', ') : t('legacyRecovery.empty');
    }
    return JSON.stringify(forDisplay(value), null, 2);
  };
  /** For two values that read alike (`null` and absent, `1` and `"1"`): exactly as stored. */
  const exact = (value: unknown): string => value === undefined ? t('legacyRecovery.absent') : JSON.stringify(forDisplay(value), null, 2);
  return { when, fieldName, shown, exact };
}

/** What a copy holds, readable, bookkeeping hidden: an operation's variables, else the whole copy. */
function copyContent(raw: string, operation: boolean): string {
  try {
    const parsed = JSON.parse(raw) as { state?: { variables?: unknown } };
    return JSON.stringify(forDisplay(operation ? parsed.state?.variables ?? parsed : parsed), null, 2);
  } catch { return raw; }
}

/** Which colour and word say what was measured about this copy — never that it is safe to drop. */
function freshnessBadge(comparison: LegacyCopyComparison | undefined): [ChipTone, string] {
  if (!comparison || comparison.server === 'missing' && comparison.kind === 'row') return ['neutral', 'missing'];
  if (comparison.kind !== 'row') return comparison.kind === 'operation' ? ['rose', 'operation'] : ['neutral', 'unreadable'];
  if (comparison.server === 'deleted') return ['neutral', 'deleted'];
  if (comparison.server === 'unknown') return ['neutral', 'unknown'];
  const byFreshness: Record<CopyFreshness, [ChipTone, string]> = {
    'server-newer': ['neutral', 'serverNewer'], 'device-newer': ['rose', 'deviceNewer'],
    'same-version': ['amber', 'sameVersion'], unknown: ['neutral', 'unknown'],
  };
  return byFreshness[comparison.freshness];
}

/**
 * One copy. It can keep the server version in one press only while its differences are on screen;
 * any other copy shows what it holds and asks before it goes.
 */
function CopyRow({ copy, comparison, busy, onRemove, onCopy, onDownload }: {
  copy: LegacyQueryCopy; comparison: LegacyCopyComparison | undefined; busy: boolean;
  onRemove: () => void; onCopy: () => void; onDownload: () => void;
}) {
  const { t } = useTranslation();
  const { when } = useCopyFormatting();
  const [asking, setAsking] = useState(false);
  const onDevice = t('legacyRecovery.onDevice'), onServer = t('legacyRecovery.onServer');
  const [tone, word] = freshnessBadge(comparison);
  const diffShown = comparison?.kind === 'row' && comparison.server === 'present' && comparison.differences.length > 0;
  let serverLine = t('legacyRecovery.serverMissing');
  if (comparison?.server === 'deleted') serverLine = t('legacyRecovery.serverDeleted');
  else if (comparison?.server === 'unknown') serverLine = t('legacyRecovery.serverUnknown');
  else if (comparison?.server === 'present') serverLine = t('legacyRecovery.changedAt', { date: when(comparison.serverVersionAt) });
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="min-w-0 break-words font-medium text-gray-900 dark:text-gray-100">
          {copy.title && copy.title !== copy.documentId ? copy.title : t('legacyRecovery.untitled')}
        </p>
        {NAMED_COLLECTIONS.has(copy.collection) && <span className="text-xs text-gray-600 dark:text-gray-400">{t(`legacyRecovery.collection.${copy.collection}`)}</span>}
        <Chip tone={tone} size="sm">{t(`legacyRecovery.freshness.${word}`)}</Chip>
      </div>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-gray-700 dark:text-gray-300">
        <dt>{onDevice}</dt>
        <dd>{t('legacyRecovery.versionFrom', { date: when(comparison?.deviceVersionAt ?? null) })}</dd>
        <dt>{onServer}</dt>
        <dd>{serverLine}</dd>
      </dl>
      {diffShown ? <CopyDifferences differences={comparison.differences} /> : <CopyContent copy={copy} comparison={comparison} />}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-gray-600 underline-offset-2 hover:underline dark:text-gray-400">{t('legacyRecovery.rawData')}</summary>
        <pre className={`mt-1 ${CONTENT}`}>{copy.raw}</pre>
      </details>
      {asking ? (
        <div role="alert" className="mt-3 rounded-lg border border-rose-300 bg-white/70 px-3 py-2 dark:border-rose-500/40 dark:bg-black/20">
          <p className="text-rose-900 dark:text-rose-100">{t('legacyRecovery.removeCopyConfirm')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={onDownload} className={SECONDARY}>{t('legacyRecovery.export')}</button>
            <button type="button" disabled={busy} onClick={onRemove} className={DANGER}>{t('legacyRecovery.removeCopyYes')}</button>
            <button type="button" disabled={busy} onClick={() => setAsking(false)} className={QUIET}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={diffShown ? onRemove : () => setAsking(true)} className={SECONDARY}>
            {diffShown ? t('legacyRecovery.keepServer') : t('legacyRecovery.removeCopy')}
          </button>
          <button type="button" disabled={busy} onClick={onCopy} className={QUIET}>{t('legacyRecovery.copyDevice')}</button>
          <button type="button" disabled={busy} onClick={onDownload} className={QUIET}>{t('legacyRecovery.export')}</button>
        </div>
      )}
    </li>
  );
}

/** A copy with nothing to show as a difference: what it holds, readable, on screen. */
function CopyContent({ copy, comparison }: { copy: LegacyQueryCopy; comparison: LegacyCopyComparison | undefined }) {
  const { t } = useTranslation();
  const operation = comparison?.kind === 'operation';
  return (
    <div className="mt-2 space-y-1">
      {operation && <p className="text-gray-700 dark:text-gray-300">{t('legacyRecovery.operationNote')}</p>}
      {comparison?.kind === 'unreadable' && <p className="text-gray-700 dark:text-gray-300">{t('legacyRecovery.unreadableNote')}</p>}
      <p className="text-xs text-gray-600 dark:text-gray-400">{t(operation ? 'legacyRecovery.operationContent' : 'legacyRecovery.copyContent')}</p>
      <pre className={CONTENT}>{copyContent(copy.raw, operation)}</pre>
    </div>
  );
}

/** The differing fields, as a diff: the device's side goes when the server is kept, the server's stays. */
function CopyDifferences({ differences }: { differences: LegacyCopyComparison['differences'] }) {
  const { t } = useTranslation();
  const { fieldName, shown, exact } = useCopyFormatting();
  const onDevice = t('legacyRecovery.onDevice'), onServer = t('legacyRecovery.onServer');
  return (
    <div className="mt-2 space-y-2">
      <p className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('legacyRecovery.differencesTitle')}</p>
      {differences.map(entry => {
        let device = shown(entry.device), server = shown(entry.server);
        if (device === server) { device = exact(entry.device); server = exact(entry.server); }
        return (
          <div key={entry.field} className="space-y-1">
            <p className="text-xs text-gray-600 dark:text-gray-400">{fieldName(entry.field)}</p>
            {device.includes('\n') || server.includes('\n') ? (
              <>
                <p className="flex flex-wrap gap-x-3 text-xs">
                  <span className="text-rose-800 dark:text-rose-200">− {onDevice}</span>
                  <span className="text-emerald-800 dark:text-emerald-200">+ {onServer}</span>
                </p>
                <DiffBlock device={device} server={server} gapLabel={count => t('legacyRecovery.unchangedLines', { count })} />
              </>
            ) : (
              <>
                <DiffLine sign="−" label={onDevice} text={device} tone="device" />
                <DiffLine sign="+" label={onServer} text={server} tone="server" />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

type DiffRow = { op: ' ' | '-' | '+'; text: string } | { gap: number };

/**
 * A unified line diff, as `git diff` shows it: longest common subsequence of lines, changed
 * lines with two lines of context, the unchanged rest folded. Very large texts skip the table and
 * show both sides whole, which is still correct, only less compact.
 */
export function lineDiff(device: string, server: string, context = 2): DiffRow[] {
  const a = device.split('\n'), b = server.split('\n');
  const ops: { op: ' ' | '-' | '+'; text: string }[] = [];
  if (a.length * b.length > 250_000) {
    ops.push(...a.map(text => ({ op: '-' as const, text })), ...b.map(text => ({ op: '+' as const, text })));
  } else {
    const width = b.length + 1;
    const common = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        common[i * width + j] = a[i] === b[j] ? common[(i + 1) * width + j + 1] + 1
          : Math.max(common[(i + 1) * width + j], common[i * width + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { ops.push({ op: ' ', text: a[i] }); i += 1; j += 1; }
      // As git shows a replacement: the old line first, then the new one.
      else if (i < a.length && (j === b.length || common[(i + 1) * width + j] >= common[i * width + j + 1])) { ops.push({ op: '-', text: a[i] }); i += 1; }
      else { ops.push({ op: '+', text: b[j] }); j += 1; }
    }
  }
  const near = ops.map((_, index) => ops.slice(Math.max(0, index - context), index + context + 1).some(entry => entry.op !== ' '));
  const rows: DiffRow[] = [];
  ops.forEach((entry, index) => {
    if (entry.op !== ' ' || near[index]) { rows.push(entry); return; }
    const last = rows[rows.length - 1];
    if (last && 'gap' in last) last.gap += 1; else rows.push({ gap: 1 });
  });
  return rows;
}

/** A structured or multi-line difference, folded to the changed lines. */
function DiffBlock({ device, server, gapLabel }: { device: string; server: string; gapLabel: (count: number) => string }) {
  return (
    <div className="max-h-72 overflow-auto rounded-md border border-amber-200 bg-white/70 py-1 font-mono text-xs dark:border-amber-500/20 dark:bg-black/20">
      {lineDiff(device, server).map((row, index) => 'gap' in row
        ? <p key={index} className="px-2 py-0.5 text-gray-500 dark:text-gray-400">{gapLabel(row.gap)}</p>
        : <p key={index} className={`flex gap-2 whitespace-pre-wrap break-words px-2 ${row.op === '-'
          ? 'bg-rose-50 text-rose-950 dark:bg-rose-500/10 dark:text-rose-100'
          : row.op === '+' ? 'bg-emerald-50 text-emerald-950 dark:bg-emerald-500/10 dark:text-emerald-100'
          : 'text-gray-600 dark:text-gray-400'}`}>
          <span aria-hidden="true" className="select-none">{row.op}</span>
          <span className="min-w-0 flex-1">{row.text || ' '}</span>
        </p>)}
    </div>
  );
}

/** One side of a difference: the device's line goes when the server is accepted, the server's stays. */
function DiffLine({ sign, label, text, tone }: { sign: string; label: string; text: string; tone: 'device' | 'server' }) {
  const palette = tone === 'device'
    ? 'bg-rose-50 text-rose-950 dark:bg-rose-500/10 dark:text-rose-100'
    : 'bg-emerald-50 text-emerald-950 dark:bg-emerald-500/10 dark:text-emerald-100';
  return (
    <div className={`flex gap-2 rounded-md px-2 py-1 ${palette}`}>
      <span aria-hidden="true" className="select-none font-mono">{sign}</span>
      <div className="min-w-0 flex-1">
        <span className="text-xs opacity-70">{label}: </span>
        <span className="block max-h-40 overflow-auto whitespace-pre-wrap break-words">{text}</span>
      </div>
    </div>
  );
}
