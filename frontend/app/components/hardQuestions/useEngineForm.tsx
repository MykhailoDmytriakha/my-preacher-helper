'use client';

import { useParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { toast } from 'sonner';

import { DataSyncStatus, type TextComparison } from '@/data-engine/DataSyncStatus';
import { hasHardQuestionFieldConflict, readHardQuestionBasisConflict, readHardQuestionThemeOrderReview, useDataDocument, useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { useConfirm } from '@/hooks/useConfirm';
import { useTranslation } from '@locales/useTranslation';

import { QUIET_BUTTON } from './parts';

import type { DocumentData } from '@/data-engine/types';

type Resource = { collection: string; id: string };
type Selection = Parameters<typeof useDataForm>[2];

/** The words a stored draft holds: every written text of its fields, a list as one line. */
export function draftWords(stage: unknown): string[] {
  return (Array.isArray(stage) ? stage : []).flatMap((field) => {
    const value = field && typeof field === 'object' && (field as { exists?: unknown }).exists ? (field as { value?: unknown }).value : undefined;
    if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
    if (Array.isArray(value)) {
      const entries = value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()));
      return entries.length ? [entries.join(', ')] : [];
    }
    return [];
  });
}
const previewOf = (words: readonly string[]) => words.join(' · ').slice(0, 160);

/**
 * A SAVE-BUTTON FORM OVER ONE DOCUMENT OF THE SECTION, the engine's way (`CouncilOutcomeForm` is the
 * model): opened, it pins what the person saw; typing is kept on the device as an unsaved stage;
 * Save sends it, Cancel drops only the unsaved typing. A reload offers the unsaved words back
 * (`recovery`), and a change made elsewhere meanwhile is a question, never a silent overwrite.
 * Must stand inside the page's `DataDocumentProvider` for the same document.
 */
export function useEngineForm(resource: Resource | null, slot: string, selection: Selection, recoveryTitle: string, recoverId?: string | null, reviewRequestId?: string) {
  const form = useDataForm(resource, slot, selection);
  const { loading, begin, active, recover, comparison, dirty, listRecoverable } = form;
  useEffect(() => { if (!loading && resource) void begin().catch(() => undefined); }, [loading, begin, resource]);
  // Opened to continue unsaved words (`UnsavedDraftNotice`): once the form is open, take that draft back
  // into it. A failure leaves the draft listed in the form's own status, where it can still be recovered.
  const recovered = useRef<string | null>(null);
  useEffect(() => {
    if (!recoverId || !active || recovered.current === recoverId) return;
    recovered.current = recoverId;
    void recover(recoverId).catch(() => undefined);
  }, [recoverId, active, recover]);
  const reviewed = useRef<string | null>(null);
  const currentReview = useRef<string | undefined>(undefined);
  const readyReview = !recoverId && active && !comparison && !dirty ? reviewRequestId : undefined;
  useLayoutEffect(() => {
    currentReview.current = readyReview;
    return () => { currentReview.current = undefined; };
  }, [readyReview]);
  useEffect(() => {
    if (!readyReview || reviewed.current === readyReview) return;
    reviewed.current = readyReview;
    // Reopen the actual saved submission, which can be a different form scope after navigation.
    void listRecoverable().then(sources => {
      const matching = sources.filter(source => source.record.predecessor?.id === readyReview);
      const originals = matching.filter(source => source.record.savedGeneration !== null);
      const choices = originals.length ? originals : matching;
      if (choices.length === 1 && currentReview.current === readyReview) return recover(choices[0].scopeId);
    }).catch(() => undefined);
  }, [readyReview, listRecoverable, recover]);
  const recovery = useRecoveryDiscovery({
    identity: form.recoveryIdentity, enabled: !loading && form.recoveryReady, version: form.recoveryVersion,
    // Each copy says what it holds: two copies of one question are told apart by their words (Codex review).
    list: async () => (await form.listRecoverable()).map((source) => ({
      id: source.scopeId, title: recoveryTitle, preview: previewOf(draftWords(source.record.stage)), discard: () => form.discardRecovery(source),
    })),
    recover: form.recover,
  });
  return { form, recovery };
}

const questionFieldLabels: Readonly<Record<string, string>> = {
  title: 'hardQuestions.question.fieldTitle',
  short: 'hardQuestions.question.short',
  detail: 'hardQuestions.question.detail',
  differ: 'hardQuestions.question.differ',
  alternates: 'hardQuestions.question.fieldAlternates',
  scriptureRefs: 'hardQuestions.question.scripture',
  basisIds: 'hardQuestions.question.restsOn',
};
const themeFieldLabels: Readonly<Record<string, string>> = {
  title: 'hardQuestions.dialogs.themeTitle',
  intro: 'hardQuestions.dialogs.intro',
};

function hardQuestionComparison(comparison: ReturnType<typeof useDataForm>['comparison'],
  t: ReturnType<typeof useTranslation>['t']): TextComparison | undefined {
  if (comparison?.basisScripture) {
    const { mine, stored, otherFields, refsUnderReview, removed } = comparison.basisScripture;
    const places = t('hardQuestions.basis.places');
    const text = (side: 'mine' | 'stored', refs: string[]) => {
      const refsText = refs.join('\n') || t('dataSync.emptyField');
      if (!otherFields?.length) return refsText;
      return [...(refsUnderReview === false ? [] : [`${places}\n${refsText}`]), ...otherFields.map(field => {
        const labels = { title: 'hardQuestions.basis.fieldTitle', text: 'hardQuestions.basis.fieldText', label: 'hardQuestions.basis.fieldLabel' } as const;
        const label = t(labels[field.field]);
        return `${label}\n${field[side] || t('dataSync.emptyField')}`;
      })].join('\n\n');
    };
    return { identity: comparison.identity,
      ...(removed ? { valueKind: 'removed-row', keepMineDisabled: true } : { valueKind: 'field', scopedChoice: true }),
      ...(otherFields?.length ? {} : { title: places }), mine: text('mine', mine),
      stored: removed ? t('hardQuestions.basis.gone') : text('stored', stored) };
  }
  if (!comparison?.hardQuestionFields?.length) return;
  const labels = comparison.stored.resource.collection === 'hardQuestions' ? questionFieldLabels : themeFieldLabels;
  const fields = [...new Set(comparison.conflictPaths.flatMap(path => path.length === 1 && labels[path[0]] ? path : []))];
  if (fields.length === 0) return;
  const words = (value: unknown) => (
    (typeof value === 'string' ? value : Array.isArray(value) ? value.join('\n') : '') || t('dataSync.emptyField')
  );
  const version = (document: typeof comparison.mine | null) => fields.map(field => {
    const text = words(document?.[field]);
    return fields.length === 1 ? text : `${t(labels[field])}\n${text}`;
  }).join('\n\n');
  return {
    identity: comparison.identity, valueKind: 'field', scopedChoice: true,
    ...(fields.length === 1 && { title: t(labels[fields[0]]) }),
    mine: version(comparison.mine), stored: version(comparison.remotePreview ?? comparison.stored.value),
  };
}

type ThemeReviewItem = NonNullable<ReturnType<typeof readHardQuestionThemeOrderReview>>['fields'][number];

const comparisonRow = (entry: unknown): entry is DocumentData =>
  entry !== null && typeof entry === 'object' && !Array.isArray(entry);

function themeOrderLabels(field: ThemeReviewItem) {
  const rows = [field.mine.value, field.theirs.value].flatMap(value => Array.isArray(value) ? value.filter(comparisonRow) : []);
  const title = (item: Record<string, unknown>) => String(item.title ?? item.id);
  const detail = (item: Record<string, unknown>) => [
    Array.isArray(item.scriptureRefs) ? item.scriptureRefs.join(', ') : '',
    typeof item.text === 'string' ? item.text.slice(0, 80) : '',
  ].filter(Boolean).join(' · ');
  return (item: Record<string, unknown>) => {
    const sameTitle = rows.filter(row => row.id !== item.id && title(row) === title(item));
    if (!sameTitle.length) return title(item);
    const note = detail(item);
    return [title(item), note, !note || sameTitle.some(row => detail(row) === note) ? String(item.id) : ''].filter(Boolean).join(' · ');
  };
}

function themeReviewWords(field: ThemeReviewItem['mine'], t: ReturnType<typeof useTranslation>['t'],
  orderLabel?: ReturnType<typeof themeOrderLabels>, rowRemoved = false): string {
  if (!field.exists) return t(rowRemoved ? 'hardQuestions.theme.rowRemoved' : 'dataSync.emptyField');
  const value = field.value;
  if (Array.isArray(value)) {
    return value.map((item, index) => orderLabel && comparisonRow(item)
      ? `${index + 1}. ${orderLabel(item)}` : String(item)).join('\n') || t('dataSync.emptyField');
  }
  if (comparisonRow(value)) {
    return [value.title, value.text, ...(Array.isArray(value.scriptureRefs) ? value.scriptureRefs : [])]
      .filter((line): line is string => typeof line === 'string' && Boolean(line)).join('\n') || JSON.stringify(value);
  }
  return typeof value === 'string' ? value || t('dataSync.emptyField') : String(value);
}

function themeReviewField(field: ThemeReviewItem, t: ReturnType<typeof useTranslation>['t']) {
  const [list, row, property] = field.path;
  const textLabel = !row && themeFieldLabels[list];
  const label = textLabel ? t(textLabel)
    : !row ? t(list === 'bases' ? 'hardQuestions.theme.basisOrder' : 'hardQuestions.theme.groupOrder')
    : [field.rowTitle, t(!property ? 'hardQuestions.theme.rowContents'
      : property === 'scriptureRefs' ? 'hardQuestions.basis.places'
      : property === 'text' ? 'hardQuestions.basis.fieldText'
      : property === 'title' ? list === 'bases' ? 'hardQuestions.basis.fieldTitle' : 'hardQuestions.dialogs.groupTitle'
      : property === 'label' ? 'hardQuestions.theme.shortLabel' : 'hardQuestions.theme.extraField')].filter(Boolean).join(' · ');
  const orderLabel = row || textLabel ? undefined : themeOrderLabels(field);
  const rowRemoved = Boolean(row && !property);
  return { id: field.id, label, mine: themeReviewWords(field.mine, t, orderLabel, rowRemoved),
    stored: themeReviewWords(field.theirs, t, orderLabel, rowRemoved) };
}

/** Open the form that owns a text comparison so its exact captured fields are used for the choice. */
export function EngineReadingStatus({ document, onReview, onReviewBasis, reviewing = false }: {
  document: ReturnType<typeof useDataDocument>; onReview: (requestId?: string) => void; onReviewBasis?: (basisId: string, requestId?: string) => void; reviewing?: boolean;
}) {
  const { t } = useTranslation();
  const checkpoint = !document.readOnly && document.status?.phase === 'conflict' ? document.state?.checkpoint : undefined;
  const listReview = checkpoint && readHardQuestionThemeOrderReview(checkpoint);
  const applyThemeOrder = document.applyHardQuestionThemeOrderReview;
  const fieldReview = checkpoint && listReview && applyThemeOrder && {
    identity: listReview.identity,
    fields: listReview.fields.map(field => themeReviewField(field, t)),
    apply: (choices: Record<string, 'local' | 'remote'>) => applyThemeOrder(checkpoint, listReview.identity, choices),
  };
  const basis = !fieldReview && checkpoint && readHardQuestionBasisConflict(checkpoint, document.state?.result);
  const answer = document.state?.result;
  const pending = Object.keys(checkpoint?.pending ?? {});
  const requestId = answer?.kind === 'conflict' ? answer.operationId : pending.length === 1 ? pending[0] : undefined;
  const review = basis && onReviewBasis ? () => onReviewBasis(basis.id, basis.requestId)
    : !fieldReview && checkpoint && hasHardQuestionFieldConflict(checkpoint) ? () => onReview(requestId) : undefined;
  if (review && reviewing) return null;
  return (
    <>
      <DataSyncStatus subject={document.recoveryIdentity} status={document.status} error={document.error} errorWords={document.errorWords} className="mt-3"
        fieldReview={fieldReview} onRetry={review || fieldReview ? undefined : document.retry}
        onKeepLocal={review || fieldReview ? undefined : () => document.keepLocal()}
        onAcceptRemote={review || fieldReview ? undefined : () => document.acceptRemote()} />
      {review && <button type="button" onClick={review} className={QUIET_BUTTON}>{t('dataSync.versionComparison')}</button>}
    </>
  );
}

/** The form's one voice about its delivery: queued, refused, changed elsewhere, words to recover. */
export function EngineFormStatus({ form, recovery, className }: ReturnType<typeof useEngineForm> & { className?: string }) {
  const { t } = useTranslation();
  const comparison = hardQuestionComparison(form.comparison, t);
  return (
    <DataSyncStatus subject={form.recoveryIdentity} status={form.status} error={form.error} errorWords={form.errorWords} className={className}
      comparison={comparison} onRetry={form.retry}
      onKeepLocal={() => form.keepLocal(undefined, form.captureDocumentMetadataAction())} onAcceptRemote={form.acceptRemote}
      recoveryChoices={recovery.choices} recoveryLoading={recovery.loading} recoveryError={recovery.error}
      onRecover={recovery.recover} onDiscardRecovery={recovery.discard} />
  );
}

/**
 * UNSAVED WORDS FOUND AFTER A RELOAD. A Save-button form keeps typing on the device, but once the page
 * is reloaded nothing is open to show it: the page reads as if the words were gone. Standing in the
 * page's reading view, this looks for the form's unsaved drafts and offers to go back to them; the form
 * then opens with the draft taken back (`useEngineForm`'s `recoverId`). Never sends anything itself.
 */
export function useUnsavedDraft(resource: Resource | null, slot: string, selection: Selection) {
  const form = useDataForm(resource, slot, selection);
  const recovery = useRecoveryDiscovery({
    identity: form.recoveryIdentity, enabled: !form.loading && form.recoveryReady, version: form.recoveryVersion,
    list: async () => (await form.listRecoverable()).map((source) => {
      const words = draftWords(source.record.stage);
      return { id: source.scopeId, title: '', preview: previewOf(words), words, discard: () => form.discardRecovery(source) };
    }),
    recover: form.recover,
  });
  const first = recovery.choices[0] as (typeof recovery.choices)[number] & { words?: string[]; discard?: () => Promise<void> } | undefined;
  return first ? { id: first.id, words: first.words ?? [], discard: first.discard } : null;
}

/**
 * WORDS LEFT ON A RECORD THAT IS GONE. Typed here and not saved, while the record was deleted on another
 * device: nothing can be edited any more, but the words are still on this device. The screen that says
 * "not found" shows them, to copy, and lets the pastor throw them away himself (Codex review, 2026-11-25).
 */
export function OrphanDraftWords({ resource, slot, selection }: { resource: Resource; slot: string; selection: Selection }) {
  const { t } = useTranslation();
  const draft = useUnsavedDraft(resource, slot, selection);
  const { confirm, confirmDialog } = useConfirm();
  if (!draft || !draft.words.length) return null;
  const text = draft.words.join('\n\n');
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => toast.success(t('hardQuestions.draft.copied')), () => toast.error(t('hardQuestions.draft.copyFailed')));
  };
  const discard = async () => {
    if (!draft.discard) return;
    if (!(await confirm({ title: { key: 'hardQuestions.draft.discardTitle' }, description: { key: 'hardQuestions.draft.discardDescription' }, confirmText: { key: 'common.delete' } }))) return;
    await draft.discard().catch(() => toast.error(t('hardQuestions.saveFailed')));
  };
  return (
    <section role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-50">
      <p className="text-sm">{t('hardQuestions.draft.orphan')}</p>
      <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white/70 p-3 text-sm text-gray-900 dark:bg-gray-900/60 dark:text-gray-100">{text}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="inline-flex min-h-10 items-center rounded-full bg-amber-900 px-4 text-sm font-semibold text-white hover:bg-amber-950 dark:bg-amber-200 dark:text-amber-950">{t('hardQuestions.draft.copy')}</button>
        <button type="button" onClick={() => void discard()} className="inline-flex min-h-10 items-center rounded-full px-3 text-sm font-semibold text-amber-900 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900/40">{t('hardQuestions.draft.discard')}</button>
      </div>
      {confirmDialog}
    </section>
  );
}

/** The reading view's word about unsaved words, with the way back to them. Renders nothing when there are none. */
export function UnsavedDraftNotice({ resource, slot, selection, onResume }: { resource: Resource; slot: string; selection: Selection; onResume: (draftId: string) => void }) {
  const { t } = useTranslation();
  const draft = useUnsavedDraft(resource, slot, selection)?.id ?? null;
  if (!draft) return null;
  return (
    <div role="status" className="mt-3 flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-50">
      <span>{t('hardQuestions.draft.found')}</span>
      <button type="button" onClick={() => onResume(draft)}
        className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full bg-amber-900 px-4 text-sm font-semibold text-white transition hover:bg-amber-950 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100">
        {t('hardQuestions.draft.resume')}
      </button>
    </div>
  );
}

/**
 * A segment of the address: the route's param, else (inside the offline shell, where the router
 * reports `/~offline`) the segment of the address in the window — as `useRouteId` does for `[id]`.
 */
/** A segment of an address as written, or as it came when it is not a valid escape («%ZZ»). */
export function safeDecode(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}

export function useRouteSegment(name: string, index: number): string {
  const params = useParams<Record<string, string | string[]>>();
  const value = params?.[name];
  if (typeof value === 'string' && value) return safeDecode(value);
  if (typeof window !== 'undefined') {
    const segments = window.location.pathname.split('/').filter(Boolean);
    if (segments.length > index) return safeDecode(segments[index]);
  }
  return '';
}
