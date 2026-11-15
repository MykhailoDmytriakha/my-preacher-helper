import { equalValues, readField, writeField } from './fieldValues';
import { PRAYER_TEXT_TARGETS } from './prayerTextAction';
import { mergeDocumentFields } from './protocol';
import { SERIES_FIELD_TARGETS } from './seriesFieldAction';

import type { ManualPath } from './manualScope';
import type { PrayerTextOpenings } from './prayerTextAction';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, ResourceSnapshot } from './types';

const seriesDescription = SERIES_FIELD_TARGETS.filter(target => target.field === 'description');

export function isManualSeriesDescriptionChoice(basis: ResourceSnapshot, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[], selection: readonly ManualPath[]): boolean {
  return basis.resource.collection === 'series' && Boolean(basis.metadata && stored?.value
    && stored.metadata?.generation === basis.metadata.generation && !stored.metadata.deleted)
    && conflicts.length === 1 && equalValues(conflicts[0].path, ['description'])
    && selection.some(path => equalValues(path, ['description']));
}

export function readDocumentTextChoice({ confirmed, remoteCandidate, draft, conflicts }: SessionCheckpoint) {
  const collection = confirmed.resource.collection;
  const targets = collection === 'prayerRequests' ? PRAYER_TEXT_TARGETS : collection === 'series' ? seriesDescription : undefined;
  const metadata = remoteCandidate?.metadata;
  const saved = remoteCandidate?.value;
  if (!targets || !confirmed.value || !draft || !saved || !metadata || metadata.deleted
    || confirmed.metadata?.generation !== metadata.generation || !conflicts.length) return;
  const openings: PrayerTextOpenings = {};
  for (const { path, mine, theirs } of conflicts) {
    const target = path.length === 1 && targets.find(({ field }) => path[0] === field);
    if (!target) continue;
    if (!equalValues(readField(draft, path), mine) || !equalValues(readField(saved, path), theirs)
      || (mine.exists && !target.accepts(mine.value)) || (theirs.exists && !target.accepts(theirs.value))) return;
    openings[target.field] = { value: theirs, generation: metadata.generation, revision: metadata.revision };
  }
  const count = Object.keys(openings).length;
  return count ? { openings, complete: count === conflicts.length } : undefined;
}

export function keepUncontestedDocumentText(base: DocumentData, draft: DocumentData, saved: DocumentData,
  fields: readonly string[]): DocumentData {
  const retained = fields.reduce((value, field) => writeField(value, [field], readField(base, [field])), draft);
  const merged = mergeDocumentFields(base, retained, saved);
  if (merged.conflicts.length || !merged.value.exists) {
    throw Object.assign(new Error('The shown text changed'), { code: 'decision-changed' });
  }
  return merged.value.value as DocumentData;
}
