import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { chooseOutlineChanges, OutlineChoiceReviewRequiredError } from '@/utils/outlineChoiceCore';
import { replaceSermonOutline } from '@/utils/sermonThoughtEdits';

import { object, readField, writeField } from './fieldValues';
import { equalValues, mergeDocumentFields, mergeFields } from './protocol';

import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, FieldValue, Json, ResourceSnapshot } from './types';
import type { Sermon, SermonOutline } from '@/models/models';

const path = ['outline'];
const OUTLINE_REVIEW = 'sermon-outline-review';
const WHOLE_OUTLINE_REVIEW = 'sermon-outline-review-whole';
const isReview = (item: ConflictDetail) => item.code === OUTLINE_REVIEW || item.code === WHOLE_OUTLINE_REVIEW;
const outline = (field: FieldValue) => (field.exists ? field.value : null) as unknown as SermonOutline | null;
const value = (outline: SermonOutline | null): FieldValue => outline === null
  ? { exists: false } : { exists: true, value: outline as unknown as Json };
export function hasSermonOutlineReview(checkpoint: SessionCheckpoint): boolean {
  return checkpoint.confirmed.resource.collection === 'sermons' && checkpoint.conflicts.some(isReview);
}

const changed = () => Object.assign(new Error('The shown structure changed'), { code: 'decision-changed' });

export interface SermonOutlineReviewInput {
  base: SermonOutline | null;
  mine: SermonOutline;
  stored: SermonOutline | null;
  reviewWhole?: boolean;
}

export function prepareSermonOutlineReview(checkpoint: SessionCheckpoint, input: SermonOutlineReviewInput): ConflictDetail | undefined {
  const { confirmed, pending, draft, remoteCandidate, conflicts } = checkpoint;
  if (confirmed.resource.collection !== 'sermons' || !confirmed.value || !draft || confirmed.metadata?.deleted
    || Object.keys(pending).length || conflicts.length || remoteCandidate
    || !equalValues(outline(readField(draft, path)), input.stored)
    || !equalValues(outline(readField(confirmed.value, path)), input.stored)) return;
  return { path, code: input.reviewWhole ? WHOLE_OUTLINE_REVIEW : OUTLINE_REVIEW, base: value(input.base), mine: value(input.mine),
    theirs: readField(confirmed.value, path) };
}

function sameGeneration(opening: ResourceSnapshot, latest: ResourceSnapshot): boolean {
  const birth = opening.value?.createdAt;
  return Boolean(opening.value && latest.value && !latest.metadata?.deleted && (opening.metadata
    ? opening.metadata.generation === latest.metadata?.generation
    : !latest.metadata && typeof birth === 'string' && latest.value.createdAt === birth));
}

export function readSermonOutlineReview(checkpoint: SessionCheckpoint) {
  if (checkpoint.confirmed.resource.collection !== 'sermons' || !checkpoint.remoteCandidate) return;
  const review = checkpoint.conflicts.find(isReview);
  const mine = review && outline(review.mine);
  if (!review || !mine) return;
  const stored = outline(review.theirs);
  const current = sameGeneration(checkpoint.confirmed, checkpoint.remoteCandidate);
  const base = outline(review.base);
  const choices = current ? chooseOutlineVersion(base, mine, stored, review.code === WHOLE_OUTLINE_REVIEW) : null;
  return { identity: JSON.stringify([checkpoint.remoteCandidate.metadata, review]), mine: choices?.outline ?? mine, stored,
    canKeep: choices !== null, requiresWholeChoice: choices?.whole === true };
}

function chooseOutlineVersion(base: SermonOutline | null, mine: SermonOutline, stored: SermonOutline | null, full: boolean) {
  if (!full) {
    try { return { outline: chooseOutlineChanges(base, mine, stored, mergeFields), whole: false }; }
    catch (failure) { if (!(failure instanceof OutlineChoiceReviewRequiredError)) throw failure; }
  }
  return { outline: mine, whole: true };
}

/** An observed revision changes the question. Keep the exact original action and refresh only its saved side. */
export function refreshSermonOutlineReview(checkpoint: SessionCheckpoint, snapshot: ResourceSnapshot): ConflictDetail | undefined {
  const review = checkpoint.conflicts.find(isReview);
  if (!review) return;
  return { ...review, theirs: snapshot.value ? readField(snapshot.value, path) : { exists: false } };
}

/** The held alternative changes only the outline. Assignments follow the chosen outline at acceptance. */
export function projectSermonOutlineDecision(checkpoint: SessionCheckpoint, side: 'local' | 'remote') {
  const { confirmed, draft, remoteCandidate: stored, conflicts, pending } = checkpoint;
  const review = conflicts.find(isReview);
  if (!review || !draft || !confirmed.value || !stored || Object.keys(pending).length) throw changed();
  const mine = outline(review.mine);
  if (!mine) throw changed();
  const saved = outline(review.theirs);
  if (!sameGeneration(confirmed, stored)) {
    if (side === 'local' || !equalValues(draft, confirmed.value)) throw changed();
    return { confirmed: stored, draft: stored.value, conflicts: [] };
  }
  const merged = mergeDocumentFields(confirmed.value, draft, stored.value);
  if (!merged.value.exists || !object(merged.value.value)) throw changed();
  let next = merged.value.value as DocumentData;
  if (side === 'local') {
    // Use the confirmed shape as the source of relationships, then update those affected by the choice.
    const chosen = chooseOutlineVersion(outline(review.base), mine, saved, review.code === WHOLE_OUTLINE_REVIEW).outline;
    next = deepCleanUndefined(replaceSermonOutline(writeField(next, path, review.theirs) as unknown as Sermon, chosen)) as unknown as DocumentData;
  }
  return { confirmed: stored, draft: next, conflicts: merged.conflicts };
}
