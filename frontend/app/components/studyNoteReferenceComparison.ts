import { isBibleId } from '@/utils/bibles';
import { formatScriptureReference } from '@/utils/scriptureReference';

import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { FieldValue, Json } from '@/data-engine/types';
import type { AppLocale } from '@/utils/appLocale';

export type StudyNoteReferenceReviewRow = { mine: FieldValue; stored: FieldValue };

export function studyNoteReferenceComparison(rows: readonly StudyNoteReferenceReviewRow[],
  t: (key: string) => string, locale: AppLocale): TextComparison {
  const label = (value: Json | undefined): string => {
    if (Array.isArray(value)) return value.map(label).join('\n\n') || t('legacyRecovery.empty');
    if (!value || typeof value !== 'object' || typeof value.book !== 'string') return t('legacyRecovery.empty');
    const bible = isBibleId(value.bible) ? value.bible : undefined;
    const place = formatScriptureReference({ ...value, book: value.book, bible }, { locale, style: 'long', bible });
    const name = bible ? place + ' · ' + bible.toUpperCase() : place;
    return typeof value.text === 'string' && value.text.trim() ? name + '\n' + value.text : name;
  };
  const side = (key: keyof StudyNoteReferenceReviewRow) => rows.map(row => label(row[key].value)).join('\n\n');
  return { title: t('studiesWorkspace.scriptureRefs'), valueKind: 'field', mine: side('mine'), stored: side('stored') };
}
