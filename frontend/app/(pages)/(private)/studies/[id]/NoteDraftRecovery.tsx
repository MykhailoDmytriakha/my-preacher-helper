'use client';

import { useId, useState } from 'react';

import { useTranslation } from '@locales/useTranslation';

import { RetainedNoteDraft } from './RetainedNoteDraft';

import type { NoteDraftPayload } from './noteDraft';
import type { DurableDraftCopy } from '@/utils/durableDraft';

/** A kept copy can be read and chosen without replacing the current note. */
export function NoteDraftRecovery({ draft, copies, selectedKey, onSelect, onRestore, onDiscard, readOnly = false }: {
  draft: NoteDraftPayload;
  copies: readonly DurableDraftCopy<NoteDraftPayload>[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onRestore: () => void;
  onDiscard: () => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const selectId = useId();
  return <section className="mb-2 space-y-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-amber-900 dark:text-amber-200">{t('unsavedDraft.title')}</p>
        <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">{t('unsavedDraft.description')}</p>
      </div>
      {!readOnly && <div className="flex shrink-0 gap-2">
        <button type="button" onClick={onRestore} className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-amber-700">{t('unsavedDraft.restore')}</button>
        <button type="button" onClick={onDiscard} className="rounded-lg border border-amber-300 px-3 py-1.5 font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20">{t('unsavedDraft.discard')}</button>
      </div>}
    </div>
    {copies.length > 1 && <label htmlFor={selectId} className="block space-y-1 text-amber-900 dark:text-amber-200">
      <span>{t('unsavedDraft.chooseCopy')}</span>
      <select id={selectId} value={selectedKey} onChange={event => onSelect(event.target.value)} className="block w-full min-w-0 rounded-lg border border-amber-300 bg-white px-3 py-2 text-gray-900 dark:border-amber-500/40 dark:bg-gray-900 dark:text-gray-100">
        {copies.map(copy => <option key={copy.key} value={copy.key}>{copy.value.title.trim() || copy.value.content.replace(/\s+/g, ' ').trim().slice(0, 100) || t('studiesWorkspace.untitled')}</option>)}
      </select>
    </label>}
    {readOnly ? <RetainedNoteDraft draft={draft} /> : <DraftPreview key={selectedKey} draft={draft} />}
  </section>;
}

function DraftPreview({ draft }: { draft: NoteDraftPayload }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-medium text-amber-900 dark:text-amber-200">{t('unsavedDraft.preview')}</summary>
    {open && <div className="mt-3"><RetainedNoteDraft draft={draft} /></div>}
  </details>;
}
