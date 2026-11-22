import { isBibleId } from '@/utils/bibles';
import { formatScriptureReference } from '@/utils/scriptureReference';
import { fieldLabel } from '@/utils/storedFieldLabel';

import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { ConflictDetail, FieldValue, Json } from '@/data-engine/types';
import type { AppLocale } from '@/utils/appLocale';

export type StudyNoteReferenceReviewRow = { mine: FieldValue; stored: FieldValue };

export function studyNoteReferenceComparison(rows: readonly StudyNoteReferenceReviewRow[],
  t: (key: string) => string, locale: AppLocale, fields: readonly ConflictDetail[] = []): TextComparison {
  const label = (value: Json | undefined): string => {
    if (Array.isArray(value)) return value.map(label).join('\n\n') || t('legacyRecovery.empty');
    if (!value || typeof value !== 'object' || typeof value.book !== 'string') return t('legacyRecovery.empty');
    const bible = isBibleId(value.bible) ? value.bible : undefined;
    const place = formatScriptureReference({ ...value, book: value.book, bible }, { locale, style: 'long', bible });
    const name = bible ? place + ' · ' + bible.toUpperCase() : place;
    return typeof value.text === 'string' && value.text.trim() ? name + '\n' + value.text : name;
  };
  const title = t('studiesWorkspace.scriptureRefs');
  const side = (key: keyof StudyNoteReferenceReviewRow) => {
    const references = rows.map(row => label(row[key].value)).join('\n\n');
    if (!fields.length) return references;
    const companionText = fields.map(({ path: [field], mine, theirs }) => {
      const value = (key === 'mine' ? mine : theirs).value;
      const text = field === 'type' && typeof value === 'string' ? t('studiesWorkspace.type.' + value)
        : Array.isArray(value) && value.every(item => typeof item === 'string') ? value.join(', ')
          : typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value);
      return fieldLabel(t, field) + '\n' + (text || t('dataSync.emptyField'));
    });
    return [...(references ? [title + '\n' + references] : []), ...companionText].join('\n\n');
  };
  return { ...(fields.length ? { description: t('dataSync.noteFieldsChanged') } : { title }),
    valueKind: 'field', mine: side('mine'), stored: side('stored') };
}
