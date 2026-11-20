import { rebaseOptionalPrayerTags, tagField, tagMembership } from './documentTagMembership';
import { equalValues, readField, writeField } from './fieldValues';
import { orderedPrayerTextField, prayerTextEditAction, PRAYER_TEXT_SETTLED, PRAYER_TEXT_TARGETS } from './prayerTextAction';
import { mergeDocumentFields } from './protocol';
import { SERIES_FIELD_TARGETS } from './seriesFieldAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { DocumentTitleSeen } from './documentFieldAction';
import type { ManualPath } from './manualScope';
import type { PrayerEditableText, PrayerTextField, PrayerTextOpenings } from './prayerTextAction';
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

function projectDocumentTextChoice(checkpoint: SessionCheckpoint) {
  const { confirmed, remoteCandidate, draft } = checkpoint;
  const queued: PrayerEditableText[] = [];
  const collection = confirmed.resource.collection;
  const textFields = collection === 'prayerRequests' ? ['title', 'description', 'answerText']
    : collection === 'planTemplates' ? ['name'] : undefined;
  if (!textFields || !confirmed.value || !draft || !remoteCandidate?.value
    || confirmed.metadata?.generation !== remoteCandidate.metadata?.generation) return { checkpoint, queued };
  let opening = confirmed.value;
  let words = draft;
  const conflicts = checkpoint.conflicts.flatMap(conflict => {
    const { path } = conflict;
    if (path.length !== 1 || !textFields.includes(path[0])) return [conflict];
    const field = orderedPrayerTextField(conflict);
    const mine = readField(words, path);
    const theirs = readField(remoteCandidate.value!, path);
    if (equalValues(mine, theirs)) return [];
    if (!field) return [{ ...conflict, mine, theirs }];
    if (!equalValues(mine, conflict.mine) || (conflict.code !== PRAYER_TEXT_SETTLED && !equalValues(theirs, conflict.theirs))) {
      return [{ path, base: readField(opening, path), mine, theirs }];
    }
    if (conflict.code === PRAYER_TEXT_SETTLED) words = writeField(words, path, readField(opening, path));
    else {
      opening = writeField(opening, path, theirs);
      queued.push(field);
    }
    return [];
  });
  // A newer snapshot may reveal a second conflict that was absent in the original answer.
  const merged = rebaseOptionalPrayerTags(collection, opening, words, remoteCandidate.value,
    mergeDocumentFields(opening, words, remoteCandidate.value));
  for (const conflict of merged.conflicts) {
    if (!conflicts.some(item => equalValues(item.path, conflict.path))) conflicts.push(conflict);
  }
  return { checkpoint: { ...checkpoint, confirmed: { ...confirmed, value: opening }, draft: words, conflicts }, queued };
}

export function readDocumentTextChoice(source: SessionCheckpoint) {
  const { checkpoint, queued } = projectDocumentTextChoice(source);
  const { confirmed, remoteCandidate, draft, conflicts } = checkpoint;
  const collection = confirmed.resource.collection;
  const template = collection === 'planTemplates';
  const targets = collection === 'prayerRequests' ? PRAYER_TEXT_TARGETS : collection === 'series' ? seriesDescription : [];
  const titleField = template ? 'name' : collection === 'prayerRequests' ? 'title' : undefined;
  if ((!targets.length && !titleField) || (template && Object.keys(checkpoint.pending).length !== 1)) return;
  const metadata = remoteCandidate?.metadata;
  const saved = remoteCandidate?.value;
  if (!confirmed.value || !draft || !saved || !metadata || metadata.deleted
    || confirmed.metadata?.generation !== metadata.generation || !conflicts.length) return;
  const openings: PrayerTextOpenings = {};
  let title: DocumentTitleSeen | undefined;
  for (const { path, mine, theirs } of conflicts) {
    if (titleField && path.length === 1 && path[0] === titleField) {
      if (typeof mine.value !== 'string' || typeof theirs.value !== 'string' || !mine.exists || !theirs.exists
        || !equalValues(readField(draft, path), mine) || !equalValues(readField(saved, path), theirs)) return;
      title = { title: theirs.value, generation: metadata.generation, revision: metadata.revision };
      continue;
    }
    const target = path.length === 1 && targets.find(({ field }) => path[0] === field);
    if (!target) continue;
    if (!equalValues(readField(draft, path), mine) || !equalValues(readField(saved, path), theirs)
      || (mine.exists && !target.accepts(mine.value)) || (theirs.exists && !target.accepts(theirs.value))) return;
    openings[target.field] = { value: theirs, generation: metadata.generation, revision: metadata.revision };
  }
  const fields = [...Object.keys(openings), ...(title && titleField ? [titleField] : [])];
  return fields.length ? { openings, title, fields, queued, checkpoint, complete: fields.length === conflicts.length } : undefined;
}

export function retryPrayerTextChoice(review: NonNullable<ReturnType<typeof readDocumentTextChoice>>, choice: 'local' | 'remote',
  request: CommitRequest | undefined, draft: DocumentData | null, time: ActionTime | null) {
  let title = choice === 'local' && review.title ? { seen: review.title, time } : undefined;
  const openings: PrayerTextOpenings = choice === 'local' ? { ...review.openings } : {};
  const originalTimes: Partial<Record<PrayerTextField, ActionTime | null>> = {};
  const generation = request?.baseline.metadata?.generation;
  const saved = review.checkpoint.remoteCandidate?.value;
  const originalTitle = request?.prayerTitleAction;
  if (!review.fields.includes('title') && generation && originalTitle && draft?.title === originalTitle.after && draft.title !== saved?.title) {
    title = { seen: { title: originalTitle.before, generation, revision: originalTitle.observedRevision }, time: originalTitle.time };
  }
  for (const { field } of PRAYER_TEXT_TARGETS) {
    if (review.fields.includes(field)) continue;
    const action = request?.prayerTextActions?.[field];
    if (!draft || !saved || !generation || !action || !equalValues(action.after, readField(draft, [field]))
      || equalValues(action.after, readField(saved, [field]))) continue;
    openings[field] = { value: action.before, generation, revision: action.observedRevision };
    originalTimes[field] = action.time;
  }
  if (review.queued.some(field => field === 'title' ? !title : !openings[field])) throw missingPrayerTextProof();
  const proposedTags = tagField(draft);
  const storedTags = tagField(saved);
  const tagIntents = generation ? request?.tagMembershipActions?.flatMap(action => {
    const { tag, before, after, time, observedRevision, predecessorOperationId } = action;
    if (tagMembership(proposedTags, tag) !== after || tagMembership(storedTags, tag) === after) return [];
    return [{ tag, before, after, time, generation, revision: observedRevision, predecessorRequestId: predecessorOperationId }];
  }) : undefined;
  return prayerTextEditAction(time, openings, title, tagIntents?.length ? tagIntents : undefined,
    Object.keys(originalTimes).length ? originalTimes : undefined);
}

const missingPrayerTextProof = () => Object.assign(new Error('The original prayer change could not be verified'), { code: 'decision-changed' });

export function keepUncontestedDocumentText(base: DocumentData, draft: DocumentData, saved: DocumentData,
  fields: readonly string[], collection = ''): DocumentData {
  const retained = fields.reduce((value, field) => writeField(value, [field], readField(base, [field])), draft);
  const merged = rebaseOptionalPrayerTags(collection, base, retained, saved, mergeDocumentFields(base, retained, saved));
  if (merged.conflicts.length || !merged.value.exists) {
    throw Object.assign(new Error('The shown text changed'), { code: 'decision-changed' });
  }
  return merged.value.value as DocumentData;
}
