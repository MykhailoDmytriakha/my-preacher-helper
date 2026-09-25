'use client';

import { useTranslation } from 'react-i18next';

import DatePickerField from '@/components/ui/DatePickerField';
import { FIELD_INPUT, FIELD_LABEL, FIELD_ROW, GROUP_CARD } from '@/components/ui/formCardClasses';

import ChurchAutocomplete from './ChurchAutocomplete';

import type { Church } from '@/models/models';

export interface PreachDateValues { date: string; church: Church; audience: string; notes: string }

/** Presentation shared by legacy and engine owners; every edit goes to its owner. */
export function PreachDateFields({ value, onChange, disabled = false }: {
  value: PreachDateValues; onChange: (patch: Partial<PreachDateValues>) => void; disabled?: boolean;
}) {
  const { t } = useTranslation();
  return <fieldset disabled={disabled} className={GROUP_CARD}>
    <div className={FIELD_ROW}>
      <label htmlFor="preach-date-input" className={FIELD_LABEL}>{t('calendar.date')}</label>
      <DatePickerField id="preach-date-input" value={value.date} onChange={date => onChange({ date })}
        inputClassName={`${FIELD_INPUT} pr-12`} required />
    </div>
    <ChurchAutocomplete value={value.church} onChange={church => onChange({ church })} />
    <div className={FIELD_ROW}>
      <label htmlFor="preach-audience-input" className={FIELD_LABEL}>{t('calendar.audience')}</label>
      <input id="preach-audience-input" value={value.audience} onChange={event => onChange({ audience: event.target.value })}
        placeholder={t('calendar.audiencePlaceholder')} className={FIELD_INPUT} />
    </div>
    <div className={FIELD_ROW}>
      <label htmlFor="preach-notes-input" className={FIELD_LABEL}>{t('calendar.notes')}</label>
      <textarea id="preach-notes-input" value={value.notes} onChange={event => onChange({ notes: event.target.value })}
        rows={3} placeholder={t('calendar.notesPlaceholder')} className={`${FIELD_INPUT} resize-none`} />
    </div>
  </fieldset>;
}
