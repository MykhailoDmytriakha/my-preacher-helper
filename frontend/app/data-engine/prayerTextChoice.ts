import { equalValues, readField, writeField } from './fieldValues';
import { PRAYER_TEXT_TARGETS, type PrayerTextOpenings } from './prayerTextAction';
import { mergeDocumentFields } from './protocol';

import type { SessionCheckpoint } from './session';
import type { DocumentData } from './types';

export function readPrayerTextChoice({ confirmed, remoteCandidate, draft, conflicts }: SessionCheckpoint) {
  const metadata = remoteCandidate?.metadata;
  const saved = remoteCandidate?.value;
  if (confirmed.resource.collection !== 'prayerRequests' || !confirmed.value || !draft || !saved || !metadata || metadata.deleted
    || confirmed.metadata?.generation !== metadata.generation || !conflicts.length) return;
  const openings: PrayerTextOpenings = {};
  for (const { path, mine, theirs } of conflicts) {
    const target = path.length === 1 && PRAYER_TEXT_TARGETS.find(({ field }) => path[0] === field);
    if (!target) continue;
    if (!equalValues(readField(draft, path), mine) || !equalValues(readField(saved, path), theirs)
      || (mine.exists && !target.accepts(mine.value)) || (theirs.exists && !target.accepts(theirs.value))) return;
    openings[target.field] = { value: theirs, generation: metadata.generation, revision: metadata.revision };
  }
  const count = Object.keys(openings).length;
  return count ? { openings, complete: count === conflicts.length } : undefined;
}

export function keepUncontestedPrayerText(checkpoint: SessionCheckpoint, choice: PrayerTextOpenings): DocumentData {
  const { confirmed, remoteCandidate, draft } = checkpoint;
  const base = confirmed.value!;
  const saved = remoteCandidate!.value!;
  const paths = Object.keys(choice).map(field => [field]);
  const retained = paths.reduce((value, path) => writeField(value, path, readField(base, path)), draft!);
  const merged = mergeDocumentFields(base, retained, saved);
  if (merged.conflicts.length || !merged.value.exists) {
    throw Object.assign(new Error('The shown prayer text changed'), { code: 'decision-changed' });
  }
  return merged.value.value as DocumentData;
}
