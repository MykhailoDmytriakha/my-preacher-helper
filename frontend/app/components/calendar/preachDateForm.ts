import { isUnspecifiedChurch } from '@/utils/church';
import { serializeContent } from '@/utils/contentFingerprint';
import { formatDateForLocale } from '@/utils/dateFormatter';
import { isDateOnlyKey, shownDayOf } from '@/utils/dateOnly';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { getEffectivePreachDateStatus, getPreferredDateToMarkAsPreached } from '@/utils/preachDateStatus';

import type { PreachDateValues } from './PreachDateFields';
import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { PreachDateFieldHistoryEntry, PreachDateFieldValue, readPreachDateFieldVersions } from '@/data-engine/preachDateFieldAction';
import type { PreachStatusHistoryEntry } from '@/data-engine/preachStatusAction';
import type { DocumentData } from '@/data-engine/types';
import type { PreachDate, PreachDateStatus, Sermon } from '@/models/models';
import type { TFunction } from 'i18next';

export type PreachDateAction = { kind: 'add' | 'edit' | 'mark' | 'unmark' | 'delete'; dateId?: string; status?: PreachDateStatus; restoreDate?: string; restoreField?: PreachDateFieldHistoryEntry & { historyId: string };
  restoreStatus?: PreachStatusHistoryEntry & { historyId: string } };
type DateVersion = NonNullable<ReturnType<typeof readPreachDateFieldVersions>>;

export function preachDateComparison(versions: DateVersion[], identity: string, t: TFunction, language: string): TextComparison {
  const label = ({ field }: DateVersion) => t(field === 'churchCity' ? 'calendar.city'
    : field === 'status' ? 'calendar.preachStatusLabel' : `calendar.${field}`);
  const words = (field: DateVersion['field'], value: PreachDateFieldValue): string => {
    if (field === 'date') {
      if (typeof value !== 'string' || !value) return t('calendar.dateNotSet');
      const day = shownDayOf(value);
      return isDateOnlyKey(day) ? formatDateForLocale(day, language, { month: 'short', day: 'numeric', year: 'numeric' }) || value : value;
    }
    if (field === 'status' && (value === 'planned' || value === 'preached')) return t(`calendar.status.${value}`);
    return (value && typeof value === 'object' ? [value.name, value.city].filter(Boolean).join(' · ') : value) || t('dataSync.emptyField');
  };
  if (versions.length === 1) {
    const [version] = versions;
    return { identity, title: label(version), valueKind: 'field', scopedChoice: true,
      mine: words(version.field, version.mine), stored: words(version.field, version.stored) };
  }
  const side = (key: 'mine' | 'stored') => versions.map(version => label(version) + ' — ' + words(version.field, version[key])).join('\n');
  return { identity, valueKind: 'field', scopedChoice: true, mine: side('mine'), stored: side('stored'),
    description: t('dataSync.noteFieldsChanged'),
    actions: { local: t('dataSync.useLocalVersion'), stored: t('dataSync.confirmStoredFields.confirm'), confirmStored: 'dataSync.confirmStoredFields' } };
}

export const PREACH_DATE_SELECTION = [['preachDates'], ['isPreached']] as const;

function writeDates(source: Sermon, dates: PreachDate[]): DocumentData {
  // Materialize legacy statuses before changing their fallback flag.
  const explicit = dates.map(date => ({ ...date, status: getEffectivePreachDateStatus(date, Boolean(source.isPreached)) }));
  return deepCleanUndefined({ ...source, preachDates: explicit, isPreached: explicit.some(date => date.status === 'preached') }) as unknown as DocumentData;
}

export function preachDateTarget(initial: Sermon | null, value: Sermon | null, action: PreachDateAction, fallback: string): string {
  if (action.dateId) return action.dateId;
  const added = value?.preachDates?.find(date => !initial?.preachDates?.some(before => before.id === date.id));
  if (added) return added.id;
  if (action.kind === 'mark' && initial) {
    // The durable stage, not today's clock, identifies a previously chosen event.
    const changed = initial.preachDates?.find(before => {
      const after = value?.preachDates?.find(date => date.id === before.id);
      return after?.status === 'preached' && serializeContent(before) !== serializeContent(after);
    });
    return changed?.id ?? getPreferredDateToMarkAsPreached(initial)?.id ?? fallback;
  }
  return fallback;
}

/** Seed the action once, inside the pinned stage; never use a list-row copy as an ancestor. */
/** The date was removed elsewhere while this window was open; said in words by its code. */
const preachDateGone = () => Object.assign(new Error('The selected preach date is no longer available'), { code: 'preach-date-gone' });

export function canRestorePreachDateField(row: PreachDate, entry: PreachDateFieldHistoryEntry): boolean {
  if (row.id !== entry.rowId || row.createdAt !== entry.rowCreatedAt) return false;
  if (entry.field !== 'churchCity') return true;
  const { id, name } = row.church;
  return serializeContent(entry.scope) === serializeContent({ id, name });
}

export function restoredPreachDateField(row: PreachDate, entry: PreachDateFieldHistoryEntry): PreachDate {
  if (!canRestorePreachDateField(row, entry)) throw preachDateGone();
  const next = { ...row, church: { ...row.church } };
  const value = entry.value;
  if (entry.field === 'church') {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || typeof value.name !== 'string'
      || (value.city !== undefined && typeof value.city !== 'string')) throw new Error('Invalid archived church');
    return { ...next, church: { id: value.id, name: value.name, ...(value.city !== undefined && { city: value.city }) } };
  }
  if (value !== null && typeof value !== 'string') throw new Error('Invalid archived field');
  if (entry.field === 'audience' || entry.field === 'notes') {
    if (value === null) delete next[entry.field];
    else next[entry.field] = value;
  } else if (value === null) delete next.church.city;
  else next.church.city = value;
  return next;
}

export function canRestorePreachStatus(row: PreachDate, entry: PreachStatusHistoryEntry): boolean {
  return row.id === entry.rowId && row.createdAt === entry.rowCreatedAt
    && (entry.value === 'planned' || entry.value === 'preached');
}

export function preparePreachDate(current: DocumentData, action: PreachDateAction, row: PreachDate): DocumentData {
  const sermon = current as unknown as Sermon, dates = sermon.preachDates ?? [];
  if (action.kind === 'unmark') return writeDates(sermon, dates.map(date => ({ ...date, status: 'planned' })));
  const existing = dates.find(date => date.id === row.id);
  if ((action.kind === 'edit' || action.kind === 'delete') && !existing) throw preachDateGone();
  if (action.kind === 'delete') return writeDates(sermon, dates.filter(date => date.id !== row.id));
  const church = !isUnspecifiedChurch(existing?.church) ? existing!.church
    : !isUnspecifiedChurch(sermon.church) ? sermon.church! : { id: '', name: '', city: '' };
  const next = { ...(existing ?? row), church,
    ...(action.kind === 'edit' && action.restoreDate !== undefined && { date: action.restoreDate }),
    ...(action.kind === 'mark' ? { status: 'preached' as const } : {}) };
  let edited = action.kind === 'edit' && action.restoreField && existing ? restoredPreachDateField(existing, action.restoreField) : next;
  if (action.kind === 'edit' && action.restoreStatus && existing) {
    if (!canRestorePreachStatus(existing, action.restoreStatus) || action.restoreStatus.value === null) throw preachDateGone();
    edited = { ...existing, status: action.restoreStatus.value };
  }
  return writeDates(sermon, existing ? dates.map(date => date.id === row.id ? edited : date) : [...dates, edited]);
}

export function patchPreachDate(current: DocumentData, id: string, patch: Partial<PreachDateValues>): DocumentData {
  const sermon = current as unknown as Sermon;
  if (!sermon.preachDates?.some(date => date.id === id)) throw preachDateGone();
  return writeDates(sermon, sermon.preachDates.map(date => date.id === id ? { ...date, ...patch } : date));
}
