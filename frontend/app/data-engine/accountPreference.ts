import { APP_LOCALES, type AppLocale } from '@/utils/appLocale';
import { isModelPreference, isModelPreferenceField, MODEL_PREFERENCE_FIELDS, type ModelPreference } from '@/utils/userModelPreference';

import { equalValues, readField, writeField } from './fieldValues';

import type { DocumentFieldObservation, DocumentFieldStamp } from './documentFieldAction';
import type { SessionCheckpoint } from './session';
import type { DocumentData, FieldValue } from './types';
import type { ReadingSettings } from '@/models/models';

const TOP_LEVEL_PREFERENCES = ['firstDayOfWeek', 'showAppVersion', 'enableAudioGeneration', 'language', ...MODEL_PREFERENCE_FIELDS] as const;
const READING_PREFERENCE_PATHS = {
  'reading.trail.history': ['reading', 'trail', 'history'],
  'reading.trail.recent': ['reading', 'trail', 'recent'],
  'reading.trail.shown': ['reading', 'trail', 'shown'],
  'reading.trail.verseStart': ['reading', 'trail', 'verseStart'],
  'reading.crossReferences.show': ['reading', 'crossReferences', 'show'],
  'reading.crossReferences.inWindow': ['reading', 'crossReferences', 'inWindow'],
  'reading.crossReferences.mode': ['reading', 'crossReferences', 'mode'],
  'reading.crossReferences.othersAsVerses': ['reading', 'crossReferences', 'othersAsVerses'],
  'reading.mine.show': ['reading', 'mine', 'show'],
  'reading.mine.comments': ['reading', 'mine', 'comments'],
  'reading.analysisHelp.short': ['reading', 'analysisHelp', 'short'],
} as const;
type ReadingPreferenceField = keyof typeof READING_PREFERENCE_PATHS;
export type AccountPreferenceField = typeof TOP_LEVEL_PREFERENCES[number] | ReadingPreferenceField;
const readingFields = Object.keys(READING_PREFERENCE_PATHS) as ReadingPreferenceField[];

export function readingPreferenceFields(part: keyof ReadingSettings, fields: readonly string[]): ReadingPreferenceField[] {
  return readingFields.filter(field => READING_PREFERENCE_PATHS[field][1] === part && fields.includes(READING_PREFERENCE_PATHS[field][2]));
}

export function accountPreferencePath(field: AccountPreferenceField): readonly string[] {
  return Object.hasOwn(READING_PREFERENCE_PATHS, field) ? READING_PREFERENCE_PATHS[field as ReadingPreferenceField] : [field];
}

export function accountPreferenceValues(data: DocumentData | null): Partial<Record<AccountPreferenceField, unknown>> {
  return data ? Object.fromEntries(ACCOUNT_PREFERENCE_TARGETS.map(({ field, path }) => [field, readField(data, path).value])) : {};
}

export function writeAccountPreference(data: DocumentData, field: AccountPreferenceField, value: PreferenceValue | null): DocumentData {
  return writeField(data, accountPreferencePath(field), value === null ? { exists: false } : { exists: true, value });
}
export type AccountPreferenceStamps = Partial<Record<AccountPreferenceField, DocumentFieldStamp>>;
export type AccountPreferenceObservations = Partial<Record<AccountPreferenceField, DocumentFieldObservation<FieldValue>>>;

export type PreferenceValue = 'monday' | 'sunday' | AppLocale | boolean | ModelPreference | number | 'main' | 'all' | 'text' | 'badge';
export type AccountPreferenceTarget = {
  field: AccountPreferenceField;
  path: readonly string[];
  proof: AccountPreferenceField;
  action: 'accountPreferenceActions';
  causal: true;
  optional: true;
  accepts: (value: unknown) => value is PreferenceValue;
};

export const ACCOUNT_PREFERENCE_TARGETS: readonly AccountPreferenceTarget[] =
  [...TOP_LEVEL_PREFERENCES, ...readingFields].map(field => ({
    field, path: accountPreferencePath(field), proof: field, action: 'accountPreferenceActions', causal: true, optional: true,
    accepts: (value): value is PreferenceValue => {
      if (field === 'firstDayOfWeek') return value === 'sunday' || value === 'monday';
      if (field === 'language') return APP_LOCALES.some(locale => locale === value);
      if (isModelPreferenceField(field)) return isModelPreference(value);
      if (field === 'reading.trail.history' || field === 'reading.trail.recent') return typeof value === 'number' && Number.isInteger(value) && value > 0;
      if (field === 'reading.crossReferences.mode') return value === 'main' || value === 'all';
      if (field === 'reading.mine.comments') return value === 'text' || value === 'badge';
      return typeof value === 'boolean';
    },
  }));

export type AccountPreferenceHistoryPage = {
  owner: string; userId: string; generation: string; nextCursor: string | null;
  entries: { id: string; fields: { field: AccountPreferenceField; value: PreferenceValue | null; winner: PreferenceValue | null }[] }[];
};

export function readAccountPreferenceComparison(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate, conflicts, editGeneration } = checkpoint;
  if (confirmed.resource.collection !== 'users' || !draft || !remoteCandidate?.value || !confirmed.metadata
    || confirmed.metadata.generation !== remoteCandidate.metadata?.generation || conflicts.length !== 1) return undefined;
  const [conflict] = conflicts;
  const target = ACCOUNT_PREFERENCE_TARGETS.find(item => equalValues(item.path, conflict.path));
  if (!target) return undefined;
  const mine = readField(draft, target.path);
  const stored = readField(remoteCandidate.value, target.path);
  const mineValue = mine.exists ? mine.value : null;
  const storedValue = stored.exists ? stored.value : null;
  if ((mineValue !== null && !target.accepts(mineValue)) || (storedValue !== null && !target.accepts(storedValue))
    || equalValues(mine, stored) || !equalValues(mine, conflict.mine) || !equalValues(stored, conflict.theirs)) return undefined;
  return { field: target.field, path: target.path, mine: mineValue, stored: storedValue,
    identity: JSON.stringify([editGeneration, remoteCandidate.metadata.generation, remoteCandidate.metadata.revision, conflict]) };
}
