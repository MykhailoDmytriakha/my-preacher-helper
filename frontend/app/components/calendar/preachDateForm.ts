import { isUnspecifiedChurch } from '@/utils/church';
import { serializeContent } from '@/utils/contentFingerprint';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { getEffectivePreachDateStatus, getPreferredDateToMarkAsPreached } from '@/utils/preachDateStatus';

import type { PreachDateValues } from './PreachDateFields';
import type { DocumentData } from '@/data-engine/types';
import type { PreachDate, PreachDateStatus, Sermon } from '@/models/models';

export type PreachDateAction = { kind: 'add' | 'edit' | 'mark' | 'unmark' | 'delete'; dateId?: string; status?: PreachDateStatus };
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
export function preparePreachDate(current: DocumentData, action: PreachDateAction, row: PreachDate): DocumentData {
  const sermon = current as unknown as Sermon, dates = sermon.preachDates ?? [];
  if (action.kind === 'unmark') return writeDates(sermon, dates.map(date => ({ ...date, status: 'planned' })));
  const existing = dates.find(date => date.id === row.id);
  if ((action.kind === 'edit' || action.kind === 'delete') && !existing) throw new Error('The selected preach date is no longer available');
  if (action.kind === 'delete') return writeDates(sermon, dates.filter(date => date.id !== row.id));
  const church = !isUnspecifiedChurch(existing?.church) ? existing!.church
    : !isUnspecifiedChurch(sermon.church) ? sermon.church! : { id: '', name: '', city: '' };
  const next = { ...(existing ?? row), church,
    ...(action.kind === 'mark' ? { status: 'preached' as const } : {}) };
  return writeDates(sermon, existing ? dates.map(date => date.id === row.id ? next : date) : [...dates, next]);
}

export function patchPreachDate(current: DocumentData, id: string, patch: Partial<PreachDateValues>): DocumentData {
  const sermon = current as unknown as Sermon;
  if (!sermon.preachDates?.some(date => date.id === id)) throw new Error('The selected preach date is no longer available');
  return writeDates(sermon, sermon.preachDates.map(date => date.id === id ? { ...date, ...patch } : date));
}
