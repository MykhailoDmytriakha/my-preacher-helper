'use client';

import { useId, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';

import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import { FORM_INPUT_CLASS } from '@/components/ui/FormField';
import { LiveTextArea, LiveTextInput } from '@/components/ui/LiveTextInput';
import { useAppLocale } from '@/hooks/useAppLocale';
import { cleanList, cleanText, readTheme, standsOnScripture } from '@/utils/hardQuestions';
import { useTranslation } from '@locales/useTranslation';

import { ListInput } from './ListInput';
import { EngineFormStatus, useEngineForm } from './useEngineForm';

import type { DocumentData } from '@/data-engine/types';
import type { HardQuestionBasis } from '@/models/models';

const labelClass = 'text-sm font-semibold text-gray-800 dark:text-gray-200';

/** A field's name is its label alone; a hint under the field is its description, not part of the name. */
function Field({ label, hint, children }: { label: string; hint?: string; children: (ids: { id: string; describedBy?: string }) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      {children({ id, ...(hint ? { describedBy: `${id}-hint` } : {}) })}
      {hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-gray-600 dark:text-gray-400">{hint}</p>}
    </div>
  );
}
const growing = `${FORM_INPUT_CLASS} mt-2 overflow-hidden`;

/**
 * A theme's title and opening words, edited through the engine's form over the theme document
 * (the page's `DataDocumentProvider`): what the pastor saw when he opened it is kept, Save sends the
 * change, a reload offers unsaved words back.
 */
/** The theme form's name and fields: the reading view looks for unsaved drafts under exactly these. */
export const THEME_FORM_SLOT = 'theme-words';
export const THEME_FORM_FIELDS = [['title'], ['intro']];

export function ThemeEditDialog({ themeId, onClose, recoverId }: { themeId: string; onClose: () => void; recoverId?: string | null }) {
  const { t } = useTranslation();
  const resource = useMemo(() => ({ collection: 'hardQuestionThemes', id: themeId }), [themeId]);
  const engine = useEngineForm(resource, THEME_FORM_SLOT, THEME_FORM_FIELDS, t('hardQuestions.theme.editTitle'), recoverId);
  const { form } = engine;
  const comparing = form.exactChoice && Boolean(form.comparison?.hardQuestionFields?.length);
  const [saving, setSaving] = useState(false);
  const theme = form.data ? readTheme(form.data, themeId) : null;
  const set = (field: 'title' | 'intro', value: string) => form.update((draft) => {
    const next = { ...draft };
    if (field === 'intro' && !value) delete next.intro;
    else next[field] = value;
    return next;
  }).catch(() => undefined);
  const close = () => { void (form.active ? form.cancel() : Promise.resolve()).then(onClose, () => undefined); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (comparing || saving || !theme?.title.trim()) return;
    setSaving(true);
    try {
      await form.save((draft) => {
        // `updatedAt` is not the form's: the server stamps it on every accepted change.
        const next: DocumentData = { ...draft, title: cleanText(String(draft.title ?? '')) ?? String(draft.title ?? '') };
        const intro = cleanText(typeof draft.intro === 'string' ? draft.intro : '');
        if (intro) next.intro = intro;
        else delete next.intro;
        return next;
      }, form.captureDocumentMetadataAction());
      onClose();
    } catch {
      // The form's status says why; the words stay.
    } finally {
      setSaving(false);
    }
  };
  const disabled = !form.active || form.readOnly;
  return (
    <FormDialog title={t('hardQuestions.theme.editTitle')} tone="rose" size="form" onClose={close} closeDisabled={saving} unsaved={form.dirty} showCloseButton onSubmit={submit}
      footer={<FormActions tone="rose" onCancel={close} cancelLabel={t('common.cancel')} submitLabel={t('common.save')} saving={saving}
        submitDisabled={disabled || comparing || !theme?.title.trim()} unsaved={form.dirty} />}>
      <EngineFormStatus {...engine} className="mb-4" />
      {theme && (
        <div className="flex flex-col gap-5">
          <Field label={t('hardQuestions.dialogs.themeTitle')}>
            {({ id }) => <LiveTextInput id={id} value={theme.title} onChange={(value) => void set('title', value)} disabled={disabled} className={`${FORM_INPUT_CLASS} mt-2`} />}
          </Field>
          <Field label={t('hardQuestions.dialogs.intro')} hint={t('hardQuestions.dialogs.introHint')}>
            {({ id, describedBy }) => <LiveTextArea id={id} aria-describedby={describedBy} value={theme.intro ?? ''} onChange={(value) => void set('intro', value)} disabled={disabled} rows={4} className={growing} />}
          </Field>
        </div>
      )}
    </FormDialog>
  );
}

type BasisFields = { title: string; text: string; scriptureRefs: string[] };

/**
 * A BASIS IS SAVED ONLY STANDING ON SCRIPTURE — at least one place, or several (the owner, 2026-11-26;
 * `standsOnScripture`). «Сохранить» stays pressable: a place typed and not yet added is added as the field is left,
 * which is the press itself, so a button switched off until then would need pressing twice. A save without a place
 * says so under the places and puts the cursor there; adding one clears it.
 */
function usePlacesRule(refs: readonly string[]) {
  const { locale } = useAppLocale();
  const [asked, setAsked] = useState(false);
  const placesRef = useRef<HTMLInputElement>(null);
  const stands = standsOnScripture(refs, locale);
  const check = () => {
    if (stands) return true;
    setAsked(true);
    placesRef.current?.focus();
    return false;
  };
  return { placesRef, missing: asked && !stands, check };
}

function BasisFieldsForm({ value, onChange, placesRef, placesMissing = false, disabled = false, autoFocus = false }: {
  value: BasisFields; onChange: (patch: Partial<BasisFields>) => void; placesRef: RefObject<HTMLInputElement | null>; placesMissing?: boolean;
  disabled?: boolean; autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-5">
      <Field label={t('hardQuestions.basis.fieldTitle')}>
        {({ id }) => <LiveTextInput id={id} value={value.title} onChange={(next) => onChange({ title: next })} disabled={disabled} autoFocus={autoFocus}
          placeholder={t('hardQuestions.basis.titlePlaceholder')} className={`${FORM_INPUT_CLASS} mt-2`} />}
      </Field>
      <Field label={t('hardQuestions.basis.fieldText')} hint={t('hardQuestions.question.markdownHint')}>
        {({ id, describedBy }) => <LiveTextArea id={id} aria-describedby={describedBy} value={value.text} onChange={(next) => onChange({ text: next })} disabled={disabled} rows={4} className={growing} />}
      </Field>
      <ListInput label={t('hardQuestions.basis.places')} values={value.scriptureRefs} disabled={disabled} inputRef={placesRef} fieldClassName={FORM_INPUT_CLASS}
        onChange={(next) => onChange({ scriptureRefs: next })} placeholder={t('hardQuestions.question.scripturePlaceholder')}
        error={placesMissing ? t('hardQuestions.basis.needsPlace') : undefined} hint={t('hardQuestions.basis.placesHint')} />
    </div>
  );
}

/** A new basis of a theme: one change to the theme document, nothing else touched. */
export function NewBasisDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (basis: Omit<HardQuestionBasis, 'id'>) => Promise<void> }) {
  const { t } = useTranslation();
  const [value, setValue] = useState<BasisFields>({ title: '', text: '', scriptureRefs: [] });
  const [saving, setSaving] = useState(false);
  const places = usePlacesRule(value.scriptureRefs);
  const unsaved = Boolean(value.title.trim() || value.text.trim() || value.scriptureRefs.length);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !value.title.trim() || !places.check()) return;
    setSaving(true);
    try { await onCreate(value); } finally { setSaving(false); }
  };
  return (
    <FormDialog title={t('hardQuestions.basis.newTitle')} tone="rose" size="form" onClose={onClose} closeDisabled={saving} unsaved={unsaved} showCloseButton onSubmit={submit}
      description={t('hardQuestions.basis.explain')}
      footer={<FormActions tone="rose" onCancel={onClose} cancelLabel={t('common.cancel')} submitLabel={t('hardQuestions.basis.create')}
        saving={saving} submitDisabled={!value.title.trim()} unsaved={unsaved} />}>
      <BasisFieldsForm value={value} onChange={(patch) => setValue((current) => ({ ...current, ...patch }))} autoFocus disabled={saving}
        placesRef={places.placesRef} placesMissing={places.missing} />
    </FormDialog>
  );
}

/** An existing basis edited through the engine's form over its theme (only that basis's fields are pinned). */
/** A basis form's name and fields: the reading view looks for unsaved drafts under exactly these. */
export const basisFormSlot = (basisId: string) => `basis:${basisId}`;
// `label` stays in the selection though the form no longer shows it (removed at the owner's word, 2026-11-26): a save
// drops a label an older basis still holds, and a form may change only the fields it selected.
export const basisFormFields = (basisId: string) => (['title', 'label', 'text', 'scriptureRefs'] as const).map((field) => ['bases', { id: basisId }, field]);

export function EditBasisDialog({ themeId, basisId, onClose, recoverId, reviewRequestId }: {
  themeId: string; basisId: string; onClose: () => void; recoverId?: string | null; reviewRequestId?: string;
}) {
  const { t } = useTranslation();
  const resource = useMemo(() => ({ collection: 'hardQuestionThemes', id: themeId }), [themeId]);
  const selection = useMemo(() => basisFormFields(basisId), [basisId]);
  const engine = useEngineForm(resource, basisFormSlot(basisId), selection, t('hardQuestions.basis.editTitle'), recoverId, reviewRequestId);
  const { form } = engine;
  const comparing = form.exactChoice && Boolean(form.comparison?.basisScripture);
  const [saving, setSaving] = useState(false);
  const basis = form.data ? (readTheme(form.data, themeId).bases ?? []).find((item) => item.id === basisId) ?? null : null;
  const value: BasisFields = { title: basis?.title ?? '', text: basis?.text ?? '', scriptureRefs: basis?.scriptureRefs ?? [] };
  const places = usePlacesRule(value.scriptureRefs);
  const write = (change: (current: Record<string, unknown>) => Record<string, unknown>) => form.update((draft) => ({
    ...draft,
    bases: (Array.isArray(draft.bases) ? draft.bases : []).map((item) =>
      item && typeof item === 'object' && !Array.isArray(item) && (item as { id?: unknown }).id === basisId ? change(item as Record<string, unknown>) : item),
  } as DocumentData)).catch(() => undefined);
  const onChange = (patch: Partial<BasisFields>) => void write((current) => {
    const next = { ...current };
    for (const [field, raw] of Object.entries(patch)) {
      const empty = Array.isArray(raw) ? raw.length === 0 : raw === '';
      if (empty && field !== 'title') delete next[field];
      else next[field] = raw;
    }
    return next;
  });
  const close = () => { void (form.active ? form.cancel() : Promise.resolve()).then(onClose, () => undefined); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (comparing || saving || !value.title.trim() || !places.check()) return;
    setSaving(true);
    try {
      await form.save((draft) => ({
        ...draft,
        bases: (Array.isArray(draft.bases) ? draft.bases : []).map((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item) || (item as { id?: unknown }).id !== basisId) return item;
          // Only the fields this form selects change: anything else the basis holds stays (Codex review 2026-11-27);
          // its old short label is one of the selected and goes (removed at the owner's word, 2026-11-26).
          const { label: _label, text: rawText, scriptureRefs: rawRefs, ...rest } = item as Record<string, unknown>;
          const text = cleanText(String(rawText ?? ''));
          const refs = cleanList(Array.isArray(rawRefs) ? rawRefs.filter((ref): ref is string => typeof ref === 'string') : []);
          return { ...rest, id: basisId, title: cleanText(String(rest.title ?? '')) ?? String(rest.title ?? ''),
            ...(text ? { text } : {}), ...(refs.length ? { scriptureRefs: refs } : {}) };
        }),
      } as DocumentData), form.captureDocumentMetadataAction());
      onClose();
    } catch {
      // The form's status says why; the words stay.
    } finally {
      setSaving(false);
    }
  };
  const disabled = !form.active || form.readOnly || !basis;
  return (
    <FormDialog title={t('hardQuestions.basis.editTitle')} tone="rose" size="form" onClose={close} closeDisabled={saving} unsaved={form.dirty} showCloseButton onSubmit={submit}
      footer={<FormActions tone="rose" onCancel={close} cancelLabel={t('common.cancel')} submitLabel={t('common.save')} saving={saving}
        submitDisabled={disabled || comparing || !value.title.trim()} unsaved={form.dirty} />}>
      <EngineFormStatus {...engine} className="mb-4" />
      {form.data && !basis ? (
        <p className="text-sm text-gray-700 dark:text-gray-300">{t('hardQuestions.basis.gone')}</p>
      ) : (
        <BasisFieldsForm value={value} onChange={onChange} disabled={disabled} placesRef={places.placesRef} placesMissing={places.missing} />
      )}
    </FormDialog>
  );
}

