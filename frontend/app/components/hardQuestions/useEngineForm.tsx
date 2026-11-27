'use client';

import { useParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { useConfirm } from '@/hooks/useConfirm';
import { useTranslation } from '@locales/useTranslation';

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
export function useEngineForm(resource: Resource | null, slot: string, selection: Selection, recoveryTitle: string, recoverId?: string | null) {
  const form = useDataForm(resource, slot, selection);
  const { loading, begin, active, recover } = form;
  useEffect(() => { if (!loading && resource) void begin().catch(() => undefined); }, [loading, begin, resource]);
  // Opened to continue unsaved words (`UnsavedDraftNotice`): once the form is open, take that draft back
  // into it. A failure leaves the draft listed in the form's own status, where it can still be recovered.
  const recovered = useRef<string | null>(null);
  useEffect(() => {
    if (!recoverId || !active || recovered.current === recoverId) return;
    recovered.current = recoverId;
    void recover(recoverId).catch(() => undefined);
  }, [recoverId, active, recover]);
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

/** The form's one voice about its delivery: queued, refused, changed elsewhere, words to recover. */
export function EngineFormStatus({ form, recovery, className }: ReturnType<typeof useEngineForm> & { className?: string }) {
  return (
    <DataSyncStatus subject={form.recoveryIdentity} status={form.status} error={form.error} errorWords={form.errorWords} className={className}
      onRetry={form.retry} onKeepLocal={form.keepLocal} onAcceptRemote={form.acceptRemote}
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
