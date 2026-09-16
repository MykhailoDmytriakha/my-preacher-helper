"use client";

import { ChevronDown } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';

import ChurchField from '@/components/church/ChurchField';
import { FIELD_INPUT, FIELD_LABEL, FIELD_ROW, GROUP_CARD, GROUP_HINT, GROUP_TITLE } from '@/components/ui/formCardClasses';
import FormDialog from '@/components/ui/FormDialog';
import DatePickerField from '@components/ui/DatePickerField';

import type { Church } from '@/models/models';

/**
 * THE ONE WINDOW FOR A SERMON'S OWN FACTS — used by "New sermon" and by "Edit sermon".
 *
 * The two doors used to be two components with two copies of the same four fields and two
 * hand-rolled shells, so they drifted: one grew grouped cards, a sticky foot and examples
 * in its placeholders, the other stayed a flat card whose Save could scroll out of reach.
 * Nothing decided which was right — they simply had no shared home. This is that home, and
 * it holds no state of its own: the caller owns the values and the writing, this owns what
 * the person sees. Creating and editing differ in DATA (which labels, whether a series can
 * be chosen, whether Save waits for a change) and never in markup, which is the only way
 * the two can stay identical without anybody remembering to keep them so.
 */

export interface SermonFormValues {
  title: string;
  verse: string;
  /** The congregation this sermon is prepared for; `undefined` while nobody named one. */
  church?: Church;
  /** `YYYY-MM-DD`, or empty for "no date yet". */
  plannedDate: string;
  seriesId: string;
}

export interface SermonSeriesOption {
  id: string;
  label: string;
}

interface SermonFormDialogProps {
  heading: string;
  values: SermonFormValues;
  onChange: (patch: Partial<SermonFormValues>) => void;
  onSubmit: (event: React.FormEvent) => void;
  onCancel: () => void;
  submitLabel: string;
  saving: boolean;
  /** Save stays down until there is something to save (the edit door uses this). */
  submitDisabled?: boolean;
  /** Offline: everything is readable, nothing is changeable. */
  readOnly?: boolean;
  error?: string;
  /** Given → the series row is offered. Omitted → the door does not manage series. */
  seriesOptions?: SermonSeriesOption[];
  /**
   * The series list has not arrived yet. "I do not know the series" and "there are no
   * series" look identical in an empty dropdown, and on a slow phone the person reads the
   * first as the second, picks "no series" because it is the only entry, and files the
   * sermon outside the series they wanted.
   */
  seriesLoading?: boolean;
  /** Omitted → no planned-date row at all (some create flows deliberately have none). */
  showPlannedDate?: boolean;
  /** Sits under the second group, in the caller's words. */
  detailsHint?: string;
  titleMaxRows?: number;
  verseMaxRows?: number;
}

export default function SermonFormDialog({
  heading,
  values,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  saving,
  submitDisabled = false,
  readOnly = false,
  error,
  seriesOptions,
  seriesLoading = false,
  showPlannedDate = false,
  detailsHint,
  titleMaxRows = 4,
  verseMaxRows = 10,
}: SermonFormDialogProps) {
  const { t } = useTranslation();
  const locked = saving || readOnly;
  const fieldId = (name: string) => `sermon-form-${name}`;

  /**
   * WHY THIS FORM CHECKS ITSELF INSTEAD OF LETTING THE BROWSER DO IT.
   *
   * `required` hands the refusal to the browser, and the browser pins its bubble to the
   * offending field. This dialog scrolls, and the field the person is looking at when they
   * press Save — the series row, at the bottom — is not the field that is empty. So Save
   * did nothing, said nothing, and the sermon was never created: the most expensive silence
   * a button can have. The check lives here, names the field in the person's language, and
   * puts them back in it.
   */
  /*
   * No asterisks on the labels: this form already groups its fields by obligation —
   * "Sermon" above, "Can be filled in later" below — so a mark on every field of the
   * first group would distinguish nothing and only add noise to what a screen reader
   * reads out.
   */
  const missingFieldRef = React.useRef<string | null>(null);
  const [missingField, setMissingField] = React.useState<string | null>(null);

  const requiredFields: { name: string; labelKey: string; value: string }[] = [
    { name: 'title', labelKey: 'addSermon.titleLabel', value: values.title },
    { name: 'verse', labelKey: 'addSermon.verseLabel', value: values.verse },
  ];

  const handleSubmit = (event: React.FormEvent) => {
    const empty = requiredFields.find((field) => !field.value.trim());
    if (!empty) {
      missingFieldRef.current = null;
      setMissingField(null);
      onSubmit(event);
      return;
    }
    event.preventDefault();
    missingFieldRef.current = empty.name;
    setMissingField(t('addSermon.fillRequiredField', { field: t(empty.labelKey) }));
    const element = document.getElementById(fieldId(empty.name));
    element?.focus();
    // Optional call on purpose: not every environment implements it, and a missing
    // scroll must never swallow the message the person needs to read.
    element?.scrollIntoView?.({ block: 'center' });
  };

  /** The caller's own error (a refused write) and this form's complaint share one place. */
  const notice = error || missingField;

  const footer = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="rounded-xl px-4 py-2.5 font-medium text-gray-600 transition hover:bg-gray-200/70 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        {t('addSermon.cancel')}
      </button>
      {/*
        A BUTTON THAT CHANGES SIZE PUSHES ITS NEIGHBOUR. "Save" becoming "Saving…" grew this
        button by a third, sliding Cancel out from under the finger already moving towards it,
        and a screenshot caught mid-repaint showed the two states printed over each other.
        The room for the longer wording is reserved from the start, so only the contents change.
      */}
      <button
        type="submit"
        disabled={locked || submitDisabled}
        aria-busy={saving || undefined}
        className="inline-flex min-w-[9.5rem] items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving && (
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-white/80 border-b-transparent"
            aria-hidden="true"
          />
        )}
        <span>{saving ? t('common.saving', { defaultValue: 'Saving...' }) : submitLabel}</span>
      </button>
    </div>
  );

  return (
    <FormDialog title={heading} onClose={onCancel} onSubmit={handleSubmit} footer={footer} closeDisabled={saving}>
      {notice && (
        <div
          role="alert"
          className="rounded-xl border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200"
        >
          {notice}
        </div>
      )}

      <section>
        <h3 className={GROUP_TITLE}>{t('addSermon.groupSermon')}</h3>
        <div className={GROUP_CARD}>
          <div className={FIELD_ROW}>
            <label htmlFor={fieldId('title')} className={FIELD_LABEL}>
              {t('addSermon.titleLabel')}
            </label>
            <TextareaAutosize
              id={fieldId('title')}
              value={values.title}
              onChange={(event) => onChange({ title: event.target.value })}
              placeholder={t('addSermon.titlePlaceholder')}
              className={`${FIELD_INPUT} resize-none`}
              minRows={1}
              maxRows={titleMaxRows}
              disabled={locked}
              aria-required="true"
              aria-invalid={missingFieldRef.current === 'title' || undefined}
            />
          </div>
          <div className={FIELD_ROW}>
            <label htmlFor={fieldId('verse')} className={FIELD_LABEL}>
              {t('addSermon.verseLabel')}
            </label>
            <TextareaAutosize
              id={fieldId('verse')}
              value={values.verse}
              onChange={(event) => onChange({ verse: event.target.value })}
              placeholder={t('addSermon.versePlaceholder')}
              className={`${FIELD_INPUT} resize-none`}
              minRows={3}
              maxRows={verseMaxRows}
              disabled={locked}
              aria-required="true"
              aria-invalid={missingFieldRef.current === 'verse' || undefined}
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className={GROUP_TITLE}>{t('addSermon.groupLater')}</h3>
        <div className={GROUP_CARD}>
          <div className={FIELD_ROW}>
            <label htmlFor={fieldId('church')} className={FIELD_LABEL}>
              {t('calendar.church')}
            </label>
            {/* A nameless church is how "cleared" travels to the writer; the picker must
                still show an empty field for it, not a blank-named selection. */}
            <ChurchField
              id={fieldId('church')}
              value={values.church?.name ? values.church : undefined}
              onChange={(church) => onChange({ church })}
              hideLabel
              disabled={locked}
              inputClassName={`${FIELD_INPUT} pr-12`}
            />
          </div>

          {showPlannedDate && (
            <div className={FIELD_ROW}>
              <label htmlFor={fieldId('plannedDate')} className={FIELD_LABEL}>
                {t('addSermon.plannedDateLabel', { defaultValue: 'Planned preaching date' })}
              </label>
              <div className="mt-1 flex items-center gap-2">
                <DatePickerField
                  id={fieldId('plannedDate')}
                  value={values.plannedDate}
                  onChange={(plannedDate) => onChange({ plannedDate })}
                  wrapperClassName="w-full"
                  inputClassName={`${FIELD_INPUT} mt-0 pr-12`}
                  disabled={locked}
                />
                {/* Only offered once there IS a date: an always-present Clear next to an
                    empty field is a control that can never do anything. */}
                {values.plannedDate && (
                  <button
                    type="button"
                    onClick={() => onChange({ plannedDate: '' })}
                    disabled={locked}
                    className="shrink-0 rounded-xl border border-gray-300 px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    {t('editSermon.clearPlannedDate', { defaultValue: 'Clear' })}
                  </button>
                )}
              </div>
            </div>
          )}

          {seriesOptions && (
            <div className={FIELD_ROW}>
              <label htmlFor={fieldId('series')} className={FIELD_LABEL}>
                {t('addSermon.seriesLabel')}
              </label>
              {seriesLoading ? (
                /* Not an empty dropdown: an empty one claims there are no series. */
                <div className="flex items-center gap-2 px-1 py-2.5 text-sm text-gray-500 dark:text-gray-400">
                  <span
                    className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-b-transparent"
                    aria-hidden="true"
                  />
                  <span>{t('workspaces.series.loadingSeries')}</span>
                </div>
              ) : (
              <div className="relative">
                <select
                  id={fieldId('series')}
                  value={values.seriesId}
                  onChange={(event) => onChange({ seriesId: event.target.value })}
                  className={`${FIELD_INPUT} appearance-none pr-12`}
                  disabled={locked}
                >
                  <option value="">{t('addSermon.noSeriesOption')}</option>
                  {seriesOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500 dark:text-gray-300"
                />
              </div>
              )}
            </div>
          )}
        </div>
        {detailsHint && (
          <p className={GROUP_HINT}>{detailsHint}</p>
        )}
      </section>
    </FormDialog>
  );
}
