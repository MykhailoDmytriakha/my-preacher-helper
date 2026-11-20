import { preparationTextField } from '@/utils/preparationFieldValues';

import { keepReviewedAuthoredLists } from './authoredListChoice';
import { AUTHORED_LIST_PROJECTION, isAuthoredListComparison } from './authoredStringList';
import { isManualSeriesDescriptionChoice } from './documentTextChoice';
import { firstGroupMeetingReview, projectFirstGroupMeetingChoice } from './groupFirstMeeting';
import { projectHomileticReview, reviewedHomileticList } from './homileticPlanChoice';
import { exactManualWords, manualChoiceFrames, replaySavedChoiceDelta } from './manualChoice';
import { sameManualSelection } from './manualScope';
import { readOutlineParentComparison } from './outlineParentChoice';
import { preachDateReviewConflicts } from './preachDateChoice';
import { readPreachDateFieldVersions } from './preachDateFieldAction';
import { equalValues, mergeDocumentFields } from './protocol';
import { canReplaceSnapshot } from './snapshotFreshness';
import { readThoughtTextConflict, thoughtTextConflictId } from './thoughtTextAction';

import type { CommitRequest } from './commits';
import type { ManualScope } from './manualScope';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, ResourceSnapshot } from './types';

export interface ManualComparison { identity: string; requestId: string; conflictPaths: readonly (readonly string[])[]; mine: DocumentData; stored: ResourceSnapshot; remotePreview?: DocumentData; canKeepLocal?: false; thoughtText?: { id: string; mine: string; stored: string }; kind?: 'first-group-meeting'; outlineParent?: NonNullable<ReturnType<typeof readOutlineParentComparison>> }

function exactSermonVerse(request: CommitRequest, conflicts: readonly ConflictDetail[], mine: DocumentData, stored: ResourceSnapshot,
  selection: ReturnType<ManualScope['getState']>['record']['selection']): boolean {
  return request.baseline.resource.collection === 'sermons' && conflicts.length === 1
    && conflicts[0].path.length === 1 && conflicts[0].path[0] === 'verse'
    && selection.some(path => path.length === 1 && path[0] === 'verse') && !sameManualSelection(mine, stored.value, ['verse']);
}

/** Only an actual answered ancestor of this selected field may explain its two versions. */
export function manualComparison(form: ReturnType<ManualScope['getState']>, parent: SessionCheckpoint,
  requests: ReadonlyMap<string, CommitRequest>, exact?: CommitRequest): ManualComparison | undefined {
  let id = exact?.id ?? form.record.predecessor?.id;
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    visited.add(id);
    const request = requests.get(id);
    if (!request || request.owner !== form.record.owner || request.baseline.resource.collection !== form.record.resource.collection
      || request.baseline.resource.id !== form.record.resource.id) return undefined;
    if (request.result?.kind === 'conflict' && (request.state === 'conflict' || form.choiceRequired)) {
      let stored = request.result.snapshot;
      const observed = parent.remoteCandidate ?? parent.confirmed;
      if (canReplaceSnapshot(stored, observed)) stored = observed;
      if (!stored.value || stored.metadata?.deleted) return undefined;
      const authored = exact ? exactManualWords(form, exact) : form.value;
      const { basis, reviewed } = manualChoiceFrames(request, authored, stored);
      const conflicts = preachDateReviewConflicts(basis.value, reviewed, stored.value, request.result.conflicts);
      const mine = keepReviewedAuthoredLists(stored.resource.collection, authored,
        conflicts.filter(item => item.code === AUTHORED_LIST_PROJECTION)) ?? authored;
      const meeting = firstGroupMeetingReview(conflicts);
      if (meeting && form.record.selection.some(path => equalValues(path, ['meetingDates']))) {
        const local = projectFirstGroupMeetingChoice(stored.value, meeting, 'local', { before: request.value, after: authored });
        const remote = projectFirstGroupMeetingChoice(stored.value, meeting, 'remote');
        return { kind: 'first-group-meeting', identity: JSON.stringify([form.record.scopeId, request.id, form.record.stage, stored]),
          requestId: request.id, conflictPaths: conflicts.filter(item => item !== meeting).map(item => item.path),
          mine: local ?? authored, stored, ...(remote && { remotePreview: remote }), ...(!local && { canKeepLocal: false as const }) };
      }
      const homiletic = reviewedHomileticList(conflicts, form.record.selection);
      if (homiletic) {
        const prepared = request.initialized && request.command;
        const basis = prepared ? request.working : request.baseline;
        const proposed = prepared ? replaySavedChoiceDelta(stored.resource, request.value, authored, request.intended) : authored;
        const local = projectHomileticReview(basis.value, proposed, stored.value, request.result.snapshot.value, homiletic, conflicts, 'local', prepared ? request.intended : request.value);
        const remote = projectHomileticReview(basis.value, proposed, stored.value, request.result.snapshot.value, homiletic, conflicts, 'remote');
        return { identity: JSON.stringify([form.record.scopeId, request.id, form.record.stage, stored]), requestId: request.id,
          conflictPaths: conflicts.map(conflict => conflict.path), mine: local ?? authored, stored: JSON.parse(JSON.stringify(stored)) as ResourceSnapshot,
          ...(remote && { remotePreview: remote }), ...(!local && { canKeepLocal: false as const }) };
      }
      const exactVerse = exact && exactSermonVerse(request, conflicts, mine, stored, form.record.selection);
      const dateField = form.record.selection.some(path => equalValues(path, ['preachDates']))
        && request.baseline.metadata?.generation === stored.metadata?.generation && conflicts.some(({ path }) => {
          const versions = readPreachDateFieldVersions(path, mine, stored.value!);
          return versions && !equalValues(versions.mine, versions.stored);
        });
      // The server can prove that series text changed and returned to the same opening words.
      const seriesDescription = isManualSeriesDescriptionChoice(request.baseline, stored, conflicts, form.record.selection)
        && !sameManualSelection(mine, stored.value, ['description']);
      const exactPreparationText = stored.resource.collection === 'sermons' && request.baseline.metadata
        && request.baseline.metadata.generation === stored.metadata?.generation
        && conflicts.some(({ path }) => preparationTextField(path) !== undefined
          && form.record.selection.some(selected => equalValues(selected, path)) && !sameManualSelection(mine, stored.value, path));
      const thoughtId = exact && conflicts.length === 1 ? thoughtTextConflictId(conflicts[0].path) : undefined;
      const exactThoughtText = thoughtId && form.record.selection.some(path => equalValues(path, ['thoughts', { id: thoughtId }])
        || equalValues(path, ['thoughts', { id: thoughtId }, 'text'])) && readThoughtTextConflict(thoughtId, mine, stored.value);
      const changed = form.record.selection.some(path => !sameManualSelection(request.baseline.value, request.value, path)
        && !sameManualSelection(request.baseline.value, stored.value, path) && !sameManualSelection(request.value, stored.value, path));
      const exactList = conflicts.some(({ code, path }) => isAuthoredListComparison(code)
        && form.record.selection.some(selected => equalValues(selected, path)) && !sameManualSelection(mine, stored.value, path));
      const outlineFrames = form.record.selection.some(path => equalValues(path, ['outline']))
        ? exact ? manualChoiceFrames(request, authored, stored) : { basis: parent.confirmed, reviewed: parent.draft }
        : undefined;
      const outlineParent = outlineFrames && readOutlineParentComparison({ confirmed: outlineFrames.basis,
        conflicts, draft: outlineFrames.reviewed, remoteCandidate: stored });
      if (changed || seriesDescription || exactPreparationText || exactVerse || dateField || exactThoughtText || exactList || outlineParent) {
        const observedConflicts = exactVerse && stored !== request.result.snapshot
          ? mergeDocumentFields(request.baseline.value, mine, stored.value).conflicts.filter(conflict => conflict.path[0] !== 'verse') : [];
        return { identity: JSON.stringify([form.record.scopeId, request.id, form.record.stage, stored]), requestId: request.id,
          conflictPaths: [...conflicts, ...observedConflicts].map(conflict => conflict.path), mine,
          ...(outlineParent && { outlineParent }), ...(thoughtId && exactThoughtText && { thoughtText: { id: thoughtId, ...exactThoughtText } }), stored: JSON.parse(JSON.stringify(stored)) as ResourceSnapshot };
      }
    }
    id = exact ? undefined : request.predecessor ?? undefined;
  }
  return undefined;
}


export function assertManualComparison(expected: string | undefined, current: ManualComparison | undefined): void {
  if (expected !== undefined && current?.identity !== expected) throw Object.assign(new Error('The shown field comparison changed'), { code: 'decision-changed' });
}
export function assertDurableManualChoice(staged: ReturnType<ManualScope['getState']> | undefined): void {
  if (staged && !staged.durable) throw Object.assign(new Error('Persist the manual form before resolving delivery'), { code: 'not-on-device-yet' });
}
export function assertManualChoiceInput(staged: ReturnType<ManualScope['getState']> | undefined, choice: 'local' | 'remote', failed: boolean, discardStage: boolean): void {
  if (staged?.dirty && !staged.choiceRequired && (choice !== 'local' || !failed) && !discardStage) throw Object.assign(new Error('Save or cancel the unsent form before resolving delivery'), { code: 'unsent-form-first' });
}
