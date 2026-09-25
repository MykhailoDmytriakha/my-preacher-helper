import { churchForNewPreachDate, churchToFillOnPreachDate } from '@/utils/church';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { getNextPlannedDate } from '@/utils/preachDateStatus';

import type { SermonFormValues } from './SermonFormDialog';
import type { DocumentData } from '@/data-engine/types';
import type { Church, PreachDate, Sermon } from '@/models/models';

export const SERMON_METADATA_SELECTION = ['title', 'verse', 'church', 'preachDates'].map(field => [field]);

/** The planned row identity is fixed by the opening form, never reselected after typing. */
export function sermonMetadataPatch(current: DocumentData, patch: Partial<SermonFormValues>, plannedId: string,
  createdAt: string, unspecifiedChurch: string): DocumentData {
  const next = { ...current };
  for (const field of ['title', 'verse', 'church'] as const) if (field in patch) {
    if (patch[field] === undefined) delete next[field]; else next[field] = patch[field] as DocumentData[string];
  }
  return patchPlannedDate(next, patch, plannedId, createdAt, unspecifiedChurch);
}

function patchPlannedDate(next: DocumentData, patch: Partial<SermonFormValues>, plannedId: string,
  createdAt: string, unspecifiedChurch: string): DocumentData {
  const dates = (next.preachDates ?? []) as unknown as PreachDate[];
  const existing = dates.find(date => date.id === plannedId);
  const church = next.church as unknown as Church | undefined;
  if ('plannedDate' in patch && !patch.plannedDate) {
    return deepCleanUndefined({ ...next, preachDates: dates.filter(date => date.id !== plannedId) }) as unknown as DocumentData;
  }
  if (patch.plannedDate) {
      const fill = existing ? churchToFillOnPreachDate(church, existing.church) : undefined;
      const date: PreachDate = existing ? { ...existing, date: patch.plannedDate, ...(fill ? { church: fill } : {}) }
        : { id: plannedId, date: patch.plannedDate, status: 'planned', createdAt, church: churchForNewPreachDate(church, unspecifiedChurch) };
      next.preachDates = (existing ? dates.map(row => row.id === plannedId ? date : row) : [...dates, date]) as unknown as DocumentData[string];
  } else if ('church' in patch && existing) {
    const fill = churchToFillOnPreachDate(church, existing.church);
    if (fill) next.preachDates = dates.map(row => row.id === plannedId ? { ...row, church: fill } : row) as unknown as DocumentData[string];
  }
  return deepCleanUndefined(next);
}


/** Recovery retains the edited row even if its date has passed since the form was opened. */
export function sermonMetadataDateId(initial: Sermon | null, value: Sermon | null, fallback: string, openedAt: Date): string {
  const original = initial?.preachDates ?? [], current = value?.preachDates ?? [];
  const edited = original.find(before => JSON.stringify(before) !== JSON.stringify(current.find(after => after.id === before.id)));
  const added = current.find(after => !original.some(before => before.id === after.id));
  return edited?.id ?? added?.id ?? (initial ? getNextPlannedDate(initial, openedAt)?.id : undefined) ?? fallback;
}
