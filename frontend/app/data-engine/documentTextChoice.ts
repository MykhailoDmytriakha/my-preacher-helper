import { isPrayerStatus } from '@/utils/prayerStatus';

import { acceptsDocumentField } from './documentFieldAction';
import { rebaseOptionalPrayerTags, tagField, tagMembership } from './documentTagMembership';
import { equalValues, readField, writeField } from './fieldValues';
import { prayerStatusReviewTarget, PRAYER_STATUS_FIELDS, PRAYER_STATUS_REVIEW, PRAYER_STATUS_SETTLED } from './prayerStatusAction';
import { orderedPrayerTextField, prayerTextEditAction, PRAYER_TEXT_SETTLED, PRAYER_TEXT_TARGETS } from './prayerTextAction';
import { mergeDocumentFields } from './protocol';
import { isReturnedSeriesField, seriesReviewFrames, SERIES_FIELD_TARGETS } from './seriesFieldAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { DocumentTitleSeen } from './documentFieldAction';
import type { ManualPath } from './manualScope';
import type { PrayerStatusCapture, PrayerStatusField, PrayerStatusObservations } from './prayerStatusAction';
import type { PrayerEditableText, PrayerTextField, PrayerTextOpenings } from './prayerTextAction';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, EditorCommitAction, ResourceSnapshot } from './types';

const seriesDescription = SERIES_FIELD_TARGETS.filter(target => target.field === 'description');

export function seriesTextChoiceFields(paths: readonly (readonly string[])[], mine: DocumentData | null,
  stored: DocumentData | null): readonly string[] | undefined {
  if (paths.length === 1 && paths[0].length === 1) {
    const [field] = paths[0];
    const target = SERIES_FIELD_TARGETS.find(item => item.field !== 'title' && item.field === field);
    if (target && mine && stored) {
      const local = readField(mine, paths[0]), saved = readField(stored, paths[0]);
      const accepts = (value: typeof local) => value.exists ? target.accepts(value.value) : 'optional' in target;
      if (accepts(local) && accepts(saved) && !equalValues(local, saved)) return [field];
    }
  }
  if (typeof mine?.title !== 'string' || typeof stored?.title !== 'string' || mine.title === stored.title
    || !paths.some(path => equalValues(path, ['title']))) return;
  const mirroredRename = mine.theme === mine.title;
  if (paths.length === 1) return mirroredRename ? ['title', 'theme'] : ['title'];
  if (paths.length === 2 && mirroredRename && stored.theme === stored.title
    && paths.some(path => equalValues(path, ['theme']))) return ['title', 'theme'];
}

export function manualSeriesTextChoiceFields(basis: ResourceSnapshot, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[], selection: readonly ManualPath[], mine: DocumentData | null) {
  if (basis.resource.collection !== 'series' || !basis.metadata || !stored?.value
    || stored.metadata?.generation !== basis.metadata.generation || stored.metadata.deleted) return;
  const fields = seriesTextChoiceFields(conflicts.map(conflict => conflict.path), mine, stored.value);
  if (fields && fields[0] !== 'description' && !conflicts.some(conflict => conflict.path[0] === fields[0] && isReturnedSeriesField(conflict))) return;
  if (fields?.every(field => selection.some(path => equalValues(path, [field])))) return fields;
}

function projectDocumentTextChoice(checkpoint: SessionCheckpoint) {
  const { confirmed, remoteCandidate, draft } = checkpoint;
  const queued: PrayerEditableText[] = [];
  const queuedStatus: PrayerStatusField[] = [];
  const collection = confirmed.resource.collection;
  const textFields = collection === 'prayerRequests' ? ['title', 'description', 'answerText']
    : collection === 'planTemplates' ? ['name'] : undefined;
  if (!textFields || !confirmed.value || !draft || !remoteCandidate?.value
    || confirmed.metadata?.generation !== remoteCandidate.metadata?.generation) return { checkpoint, queued, queuedStatus };
  let opening = confirmed.value;
  let words = draft;
  const conflicts = checkpoint.conflicts.flatMap(conflict => {
    const { path } = conflict;
    const prayerStatus = collection === 'prayerRequests' && prayerStatusReviewTarget(conflict);
    if (!prayerStatus && (path.length !== 1 || !textFields.includes(path[0]))) return [conflict];
    const field = orderedPrayerTextField(conflict);
    const orderedStatus = prayerStatus && conflict.code !== PRAYER_STATUS_REVIEW && prayerStatus.field;
    const settled = conflict.code === PRAYER_TEXT_SETTLED || conflict.code === PRAYER_STATUS_SETTLED;
    const mine = readField(words, path);
    const theirs = readField(remoteCandidate.value!, path);
    if (equalValues(mine, theirs)) return [];
    if (!field && !orderedStatus) return [{ ...conflict, mine, theirs }];
    if (!equalValues(mine, conflict.mine) || (!settled && !equalValues(theirs, conflict.theirs))) {
      return [{ path, ...(orderedStatus && { code: PRAYER_STATUS_REVIEW }), base: readField(opening, path), mine, theirs }];
    }
    if (settled) words = writeField(words, path, readField(opening, path));
    else {
      opening = writeField(opening, path, theirs);
      if (field) queued.push(field);
      if (orderedStatus) queuedStatus.push(orderedStatus);
    }
    return [];
  });
  // A newer snapshot may reveal a second conflict that was absent in the original answer.
  const merged = rebaseOptionalPrayerTags(collection, opening, words, remoteCandidate.value,
    mergeDocumentFields(opening, words, remoteCandidate.value));
  for (const conflict of merged.conflicts) {
    if (!conflicts.some(item => equalValues(item.path, conflict.path))) conflicts.push(conflict);
  }
  return { checkpoint: { ...checkpoint, confirmed: { ...confirmed, value: opening }, draft: words, conflicts }, queued, queuedStatus };
}

export function readDocumentTextChoice(source: SessionCheckpoint) {
  const { checkpoint, queued, queuedStatus } = projectDocumentTextChoice(source);
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
  if (collection === 'series' && conflicts.some(isReturnedSeriesField) && Object.keys(checkpoint.pending).length === 1) {
    const series = seriesReviewFrames(confirmed, draft, remoteCandidate, conflicts);
    const revised = series.reviewed!;
    const observed = mergeDocumentFields(series.basis.value, revised, saved).conflicts;
    const paths = [...series.conflicts, ...observed.filter(item => !series.conflicts.some(conflict => equalValues(conflict.path, item.path)))];
    const fields = seriesTextChoiceFields(paths.map(item => item.path), revised, saved);
    const field = fields?.[0];
    if (fields && field && paths.some(conflict => conflict.path[0] === field && isReturnedSeriesField(conflict))) {
      const compared = paths.filter(item => equalValues(item.path, [field])).map(item => ({ ...item,
        mine: readField(draft, item.path), theirs: readField(saved, item.path) }));
      return { openings: {}, fields, queued, queuedStatus, checkpoint: { ...checkpoint, confirmed: series.basis, draft: revised, conflicts: compared }, complete: true, title: undefined, prayerStatusFields: [] as PrayerStatusField[] };
    }
  }
  const openings: PrayerTextOpenings = {};
  const prayerStatusFields: PrayerStatusField[] = [];
  let title: DocumentTitleSeen | undefined;
  for (const conflict of conflicts) {
    const { path, mine, theirs } = conflict;
    const status = collection === 'prayerRequests' && prayerStatusReviewTarget(conflict);
    if (status) {
      if (!equalValues(readField(draft, path), mine) || !equalValues(readField(saved, path), theirs)
        || !acceptsDocumentField(mine, status) || !acceptsDocumentField(theirs, status)) return;
      prayerStatusFields.push(status.field);
      continue;
    }
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
  const fields = [...Object.keys(openings), ...(title && titleField ? [titleField] : []), ...prayerStatusFields];
  return fields.length ? { openings, title, fields, prayerStatusFields, queued, queuedStatus, checkpoint, complete: fields.length === conflicts.length } : undefined;
}

export function retryPrayerTextChoice(review: NonNullable<ReturnType<typeof readDocumentTextChoice>>, choice: 'local' | 'remote',
  request: CommitRequest | undefined, draft: DocumentData | null, time: ActionTime | null): EditorCommitAction | undefined {
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
  const membership = tagIntents?.length ? tagIntents : undefined;
  const keptTimes = Object.keys(originalTimes).length ? originalTimes : undefined;
  if (review.prayerStatusFields.length) {
    const metadata = review.checkpoint.remoteCandidate?.metadata;
    if (!saved || !metadata || !isPrayerStatus(saved.status)) throw missingPrayerTextProof();
    const original: PrayerStatusObservations = {};
    for (const target of PRAYER_STATUS_FIELDS) {
      if (review.fields.includes(target.field) || !draft || equalValues(readField(draft, [target.field]), readField(saved, [target.field]))) continue;
      const action = generation === metadata.generation ? request?.[target.action] : undefined;
      const after = target.field === 'status' ? draft.status : readField(draft, [target.field]);
      if (action && equalValues(action.after, after)) Object.assign(original, { [target.action]: action });
      else if (review.queuedStatus.includes(target.field)) throw missingPrayerTextProof();
    }
    const fields = choice === 'local' ? review.prayerStatusFields : [];
    if (fields.length || Object.keys(original).length) {
      const status: PrayerStatusCapture = { time, fields, original, reviewed: true, opening: {
        generation: metadata.generation, revision: metadata.revision, status: saved.status, answeredAt: readField(saved, ['answeredAt']),
      } };
      if (!Object.keys(openings).length && !title && !membership) return { kind: 'prayer-status', status };
      return { kind: 'prayer-text', status, text: { time, openings, ...(keptTimes && { originalTimes: keptTimes }) },
        title, tagMembership: membership };
    }
  }
  return prayerTextEditAction(time, openings, title, membership, keptTimes);
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
