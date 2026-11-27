'use client';

import { CheckIcon } from '@heroicons/react/24/outline';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { LiveTextArea, LiveTextInput } from '@/components/ui/LiveTextInput';
import { useDiscardQuestion } from '@/hooks/useConfirm';
import { cleanList, cleanText, readQuestion } from '@/utils/hardQuestions';
import { useTranslation } from '@locales/useTranslation';

import { ListInput } from './ListInput';
import { BASIS_CHIP, FIELD, PRIMARY_BUTTON, SECONDARY_BUTTON } from './parts';
import { EngineFormStatus, useEngineForm } from './useEngineForm';

import type { DocumentData } from '@/data-engine/types';
import type { HardQuestionBasis } from '@/models/models';

const EDITED_FIELDS = ['title', 'alternates', 'short', 'detail', 'differ', 'scriptureRefs', 'basisIds'] as const;
/** The form's name and fields: the reading view looks for unsaved drafts under exactly these (`UnsavedDraftNotice`). */
export const QUESTION_FORM_SLOT = 'question-words';
export const QUESTION_FORM_FIELDS = EDITED_FIELDS.map((field) => [field]);
type EditedField = typeof EDITED_FIELDS[number];

/** A field set to nothing leaves the document: an answer erased is "no answer", not an empty string kept. */
function withField(draft: DocumentData, field: EditedField, value: string | string[] | undefined): DocumentData {
  const next = { ...draft };
  if (value === undefined || (Array.isArray(value) && !value.length)) delete next[field];
  else next[field] = value;
  return next;
}

/**
 * What Save keeps: every text trimmed, every list cleaned. The basis links stay as they are: a basis the
 * theme no longer has is simply not shown, and filtering by the bases known at this moment dropped every
 * link of an answer saved while its theme was still loading (Codex review, 2026-11-25).
 */
function kept(draft: DocumentData): DocumentData {
  const question = readQuestion(draft, '');
  // `updatedAt` is not the form's: the server stamps it on every accepted change (`acceptedResource.server.ts`).
  let next: DocumentData = { ...draft };
  next = withField(next, 'title', cleanText(question.title) ?? question.title);
  next = withField(next, 'alternates', cleanList(question.alternates));
  next = withField(next, 'short', cleanText(question.short));
  next = withField(next, 'detail', cleanText(question.detail));
  next = withField(next, 'differ', cleanText(question.differ));
  next = withField(next, 'scriptureRefs', cleanList(question.scriptureRefs));
  next = withField(next, 'basisIds', [...new Set(question.basisIds ?? [])]);
  return next;
}

const textareaClass = `${FIELD} resize-none overflow-hidden leading-relaxed`;

/** A field's name is its label alone; the hint under the name is its description, not part of the name. */
function Field({ label, hint, children }: { label: string; hint?: string; children: (ids: { id: string; describedBy?: string }) => ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-gray-800 dark:text-gray-200">{label}</label>
      {hint && <p id={hintId} className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{hint}</p>}
      {children({ id, ...(hint ? { describedBy: hintId } : {}) })}
    </div>
  );
}

/**
 * THE QUESTION'S WORDS, EDITED — one Save-button form over the question's document
 * (`useEngineForm`): the question itself, its other wordings, the short answer, the bases it rests
 * on, the places, the detail, where churches differ. Answers are Markdown: the page shows them with
 * their references as links. The theme and the group are changed by «Перенести», not here.
 */
export function QuestionEditor({ questionId, bases, onDone, recoverId, reviewRequestId, gone = false }: {
  questionId: string; bases: readonly HardQuestionBasis[]; onDone: () => void; recoverId?: string | null; reviewRequestId?: string;
  /** The question was deleted (here or on another device) while it was being edited: the words stay in the fields to copy. */
  gone?: boolean;
}) {
  const { t } = useTranslation();
  const resource = useMemo(() => ({ collection: 'hardQuestions', id: questionId }), [questionId]);
  const engine = useEngineForm(resource, QUESTION_FORM_SLOT, QUESTION_FORM_FIELDS, t('hardQuestions.question.editTitle'), recoverId, reviewRequestId);
  const { form } = engine;
  const comparing = form.exactChoice && Boolean(form.comparison?.hardQuestionFields?.length);
  const { askBeforeDiscard, discardDialog } = useDiscardQuestion();
  const [saving, setSaving] = useState(false);
  const question = form.data ? readQuestion(form.data, questionId) : null;
  const set = (field: EditedField, value: string | string[] | undefined) =>
    form.update((draft) => withField(draft, field, value)).catch(() => undefined);

  const save = async () => {
    if (comparing || saving || !question?.title.trim()) return;
    setSaving(true);
    try {
      await form.save(kept, form.captureDocumentMetadataAction());
      onDone();
    } catch {
      // The form's own status says why; the words stay in the form.
    } finally {
      setSaving(false);
    }
  };
  const cancel = () => {
    void askBeforeDiscard(form.dirty, () => { void (form.active ? form.cancel() : Promise.resolve()).then(onDone, () => undefined); });
  };
  const toggleBasis = (id: string) => {
    const current = question?.basisIds ?? [];
    void set('basisIds', current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  };
  const disabled = !form.active || form.readOnly;
  const copyAll = () => {
    const words = [question?.title, ...(question?.alternates ?? []), question?.short, question?.detail, question?.differ, ...(question?.scriptureRefs ?? [])]
      .filter((value): value is string => Boolean(value?.trim())).join('\n\n');
    void navigator.clipboard?.writeText(words).then(() => toast.success(t('hardQuestions.draft.copied')), () => toast.error(t('hardQuestions.draft.copyFailed')));
  };

  return (
    <form className="mt-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <EngineFormStatus {...engine} className="mb-4" />
      {gone && (
        <div role="status" className="mb-4 flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-50">
          <span>{t('hardQuestions.draft.goneWhileEditing')}</span>
          <button type="button" onClick={copyAll} className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full bg-amber-900 px-4 text-sm font-semibold text-white hover:bg-amber-950 dark:bg-amber-200 dark:text-amber-950">{t('hardQuestions.draft.copy')}</button>
        </div>
      )}
      {!question ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('common.loading')}</p>
      ) : (
        <div className="flex flex-col gap-6">
          <Field label={t('hardQuestions.question.fieldTitle')}>
            {({ id }) => <LiveTextInput id={id} value={question.title} onChange={(value) => void set('title', value)} disabled={disabled}
              className={`${FIELD} mt-2 text-lg font-semibold`} required aria-required="true" />}
          </Field>

          <ListInput label={t('hardQuestions.question.fieldAlternates')} values={question.alternates ?? []} disabled={disabled}
            onChange={(values) => void set('alternates', values)} placeholder={t('hardQuestions.question.alternatesPlaceholder')}
            hint={t('hardQuestions.question.alternatesHint')} />

          <Field label={t('hardQuestions.question.short')} hint={t('hardQuestions.question.shortHint')}>
            {({ id, describedBy }) => <LiveTextArea id={id} aria-describedby={describedBy} value={question.short ?? ''} onChange={(value) => void set('short', value)}
              disabled={disabled} rows={3} className={`${textareaClass} mt-2`} />}
          </Field>

          {bases.length > 0 && (
            <fieldset>
              <legend className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t('hardQuestions.question.restsOn')}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {bases.map((basis) => {
                  const on = (question.basisIds ?? []).includes(basis.id);
                  return (
                    <button key={basis.id} type="button" aria-pressed={on} disabled={disabled} onClick={() => toggleBasis(basis.id)}
                      className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition disabled:opacity-60 ${on
                        ? BASIS_CHIP
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'}`}>
                      {on && <CheckIcon className="h-4 w-4" aria-hidden="true" />}
                      {basis.title}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          <ListInput label={t('hardQuestions.question.scripture')} values={question.scriptureRefs ?? []} disabled={disabled}
            onChange={(values) => void set('scriptureRefs', values)} placeholder={t('hardQuestions.question.scripturePlaceholder')}
            hint={t('hardQuestions.question.scriptureHint')} />

          <Field label={t('hardQuestions.question.detail')} hint={t('hardQuestions.question.markdownHint')}>
            {({ id, describedBy }) => <LiveTextArea id={id} aria-describedby={describedBy} value={question.detail ?? ''} onChange={(value) => void set('detail', value)}
              disabled={disabled} rows={8} className={`${textareaClass} mt-2`} />}
          </Field>

          <Field label={t('hardQuestions.question.differ')} hint={t('hardQuestions.question.differHint')}>
            {({ id, describedBy }) => <LiveTextArea id={id} aria-describedby={describedBy} value={question.differ ?? ''} onChange={(value) => void set('differ', value)}
              disabled={disabled} rows={2} className={`${textareaClass} mt-2`} />}
          </Field>
        </div>
      )}
      <div className="sticky bottom-0 z-10 -mx-4 mt-8 flex flex-col-reverse gap-2 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:justify-end sm:rounded-b-2xl dark:border-gray-800 dark:bg-gray-900/95">
        <button type="button" onClick={cancel} className={SECONDARY_BUTTON}>{t('common.cancel')}</button>
        <button type="submit" disabled={gone || comparing || saving || disabled || !question?.title.trim()} className={`${PRIMARY_BUTTON} sm:min-w-[9.5rem]`} aria-busy={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
      {discardDialog}
    </form>
  );
}
