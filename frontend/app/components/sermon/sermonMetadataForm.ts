import { churchForNewPreachDate, churchToFillOnPreachDate, isUnspecifiedChurch } from '@/utils/church';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { getNextPlannedDate, getOnlyUndatedPreachDate } from '@/utils/preachDateStatus';

import type { SermonFormValues } from './SermonFormDialog';
import type { DocumentData } from '@/data-engine/types';
import type { Church, PreachDate, Sermon } from '@/models/models';

export const SERMON_METADATA_SELECTION = ['title', 'verse', 'church', 'preachDates'].map(field => [field]);

/** A church supplied by this draft stays provisional until the form is saved. */
function plannedChurch(church: Church | undefined, row: PreachDate, opening: PreachDate | undefined, unspecifiedChurch: string): Church {
  if (!opening) return churchForNewPreachDate(church, unspecifiedChurch);
  if (!isUnspecifiedChurch(opening.church)) return row.church;
  return churchToFillOnPreachDate(church, opening.church) ?? opening.church;
}

/** The planned row identity and its originally named church are fixed by the opening form. */
export function sermonMetadataPatch(current: DocumentData, patch: Partial<SermonFormValues>, plannedId: string,
  createdAt: string, unspecifiedChurch: string, openingRow: PreachDate | undefined): DocumentData {
  const next = { ...current };
  for (const field of ['title', 'verse', 'church'] as const) if (field in patch) {
    if (patch[field] === undefined) delete next[field]; else next[field] = patch[field] as DocumentData[string];
  }

  const dates = (next.preachDates ?? []) as unknown as PreachDate[];
  const existing = dates.find(date => date.id === plannedId);
  const church = next.church as unknown as Church | undefined;
  if ('plannedDate' in patch && !patch.plannedDate) {
    if (existing) next.preachDates = (openingRow
      ? dates.map(row => row.id === plannedId ? { ...row, date: '' } : row)
      : dates.filter(row => row.id !== plannedId)) as unknown as DocumentData[string];
  } else if (existing && (patch.plannedDate || 'church' in patch)) {
    const date = { ...existing, date: patch.plannedDate ?? existing.date,
      church: plannedChurch(church, existing, openingRow, unspecifiedChurch) };
    next.preachDates = dates.map(row => row.id === plannedId ? date : row) as unknown as DocumentData[string];
  } else if (patch.plannedDate) {
    const date: PreachDate = { id: plannedId, date: patch.plannedDate, status: 'planned', createdAt,
      church: churchForNewPreachDate(church, unspecifiedChurch) };
    next.preachDates = [...dates, date] as unknown as DocumentData[string];
  }
  return deepCleanUndefined(next);
}

export function sermonMetadataForSave(current: DocumentData, plannedId: string, openingRow: PreachDate | undefined,
  unspecifiedChurch: string): DocumentData {
  const next = { ...current, title: String(current.title).trim(), verse: String(current.verse).trim() };
  const dates = (current.preachDates ?? []) as unknown as PreachDate[];
  const row = dates.find(date => date.id === plannedId);
  // A draft from before the fix can already contain a provisional name left by the first keystroke.
  if (!row || (openingRow && (!isUnspecifiedChurch(openingRow.church) || isUnspecifiedChurch(row.church)))) return next;
  const church = plannedChurch(current.church as unknown as Church | undefined, row, openingRow, unspecifiedChurch);
  return { ...next, preachDates: dates.map(date => date.id === plannedId ? { ...date, church } : date) as unknown as DocumentData[string] };
}

/** Recovery retains the edited row even if its date has passed since the form was opened. */
export function sermonMetadataDateId(initial: Sermon | null, value: Sermon | null, fallback: string, openedAt: Date): string {
  const original = initial?.preachDates ?? [], current = value?.preachDates ?? [];
  const edited = original.find(before => JSON.stringify(before) !== JSON.stringify(current.find(after => after.id === before.id)));
  const added = current.find(after => !original.some(before => before.id === after.id));
  const changed = edited ?? added;
  if (changed) return changed.id;
  if (!initial) return fallback;
  return getNextPlannedDate(initial, openedAt)?.id ?? getOnlyUndatedPreachDate(initial)?.id ?? fallback;
}
