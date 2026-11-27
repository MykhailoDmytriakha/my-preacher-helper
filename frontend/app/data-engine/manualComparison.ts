import { preparationTextField } from '@/utils/preparationFieldValues';

import { keepReviewedAuthoredLists } from './authoredListChoice';
import { AUTHORED_LIST_PROJECTION, isAuthoredListComparison } from './authoredStringList';
import { manualSeriesTextChoiceFields } from './documentTextChoice';
import { object } from './fieldValues';
import { firstGroupMeetingReview, projectFirstGroupMeetingChoice } from './groupFirstMeeting';
import { hardQuestionTextField, type HardQuestionTextField } from './hardQuestionFieldAction';
import { basisScriptureConflictId, hardQuestionBasisScriptureId } from './hardQuestionThemeLists';
import { projectHomileticReview, reviewedHomileticList } from './homileticPlanChoice';
import { exactManualWords, manualChoiceFrames, replaySavedChoiceDelta } from './manualChoice';
import { sameManualSelection } from './manualScope';
import { readOutlineParentComparison } from './outlineParentChoice';
import { preachDateReviewConflicts } from './preachDateChoice';
import { readPreachDateFieldVersions } from './preachDateFieldAction';
import { equalValues, mergeDocumentFields } from './protocol';
import { isReturnedSeriesField } from './seriesFieldAction';
import { isReturnedSermonTitle, isSermonChurchReview, isSermonVerseReview, reviewedSermonPreparationField, withReviewedSermonChurchDates } from './sermonFieldChoice';
import { canReplaceSnapshot } from './snapshotFreshness';
import { readThoughtTextConflict, thoughtTextConflictId } from './thoughtTextAction';

import type { CommitRequest } from './commits';
import type { ManualScope } from './manualScope';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, ResourceSnapshot } from './types';

export interface ManualComparison { identity: string; requestId: string; conflictPaths: readonly (readonly string[])[]; mine: DocumentData; stored: ResourceSnapshot; remotePreview?: DocumentData; canKeepLocal?: false; thoughtText?: { id: string; mine: string; stored: string }; kind?: 'first-group-meeting' | 'returned-sermon-title' | 'returned-sermon-verse' | 'sermon-church'; preparationField?: ReturnType<typeof reviewedSermonPreparationField>; returnedSeriesFields?: readonly string[]; hardQuestionFields?: readonly HardQuestionTextField[]; basisScripture?: BasisScriptureComparison; outlineParent?: NonNullable<ReturnType<typeof readOutlineParentComparison>> }

type BasisTextField = 'title' | 'text';
type BasisScriptureComparison = {
  id: string;
  mine: string[];
  stored: string[];
  otherFields: { field: BasisTextField; mine: string; stored: string }[];
  removed?: true;
};

function exactSermonVerse(request: CommitRequest, conflicts: readonly ConflictDetail[], mine: DocumentData, stored: ResourceSnapshot,
  selection: ReturnType<ManualScope['getState']>['record']['selection']): boolean {
  return request.baseline.resource.collection === 'sermons' && conflicts.length === 1
    && conflicts[0].path.length === 1 && conflicts[0].path[0] === 'verse'
    && request.baseline.metadata?.generation === stored.metadata?.generation
    && selection.some(path => path.length === 1 && path[0] === 'verse') && !sameManualSelection(mine, stored.value, ['verse']);
}

function basisRow(value: DocumentData, id: string): DocumentData | undefined {
  const rows = Array.isArray(value.bases) ? value.bases : [];
  const row = rows.find(item => object(item) && item.id === id);
  return object(row) ? row : undefined;
}

function basisScriptureWords(row: DocumentData | undefined): string[] {
  return Array.isArray(row?.scriptureRefs) ? row.scriptureRefs.filter((ref): ref is string => typeof ref === 'string') : [];
}

function compareBasisScripture(id: string, mine: DocumentData, stored: DocumentData, conflicts: readonly ConflictDetail[]): BasisScriptureComparison {
  const local = basisRow(mine, id), saved = basisRow(stored, id);
  const otherFields = (['title', 'text'] as const).flatMap(field => {
    const words = local?.[field], storedWords = saved?.[field];
    const show = saved ? conflicts.some(item => equalValues(item.path, ['bases', `id:${id}`, field])) : typeof words === 'string' && Boolean(words);
    return show
      ? [{ field, mine: typeof words === 'string' ? words : '', stored: typeof storedWords === 'string' ? storedWords : '' }] : [];
  });
  return { id, mine: basisScriptureWords(local), stored: basisScriptureWords(saved), otherFields, ...(!saved && { removed: true }) };
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
      const { basis, reviewed, conflicts: reviewedConflicts } = manualChoiceFrames(request, authored, stored);
      const conflicts = preachDateReviewConflicts(basis.value, reviewed, stored.value, reviewedConflicts);
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
      const returnedVerse = exactVerse && isSermonVerseReview(conflicts[0]);
      const returnedTitle = exact && stored.resource.collection === 'sermons' && conflicts.length === 1
        && isReturnedSermonTitle(conflicts[0]) && request.baseline.metadata?.generation === stored.metadata?.generation
        && form.record.selection.some(path => equalValues(path, ['title'])) && !sameManualSelection(mine, stored.value, ['title']);
      const church = exact && stored.resource.collection === 'sermons' && conflicts.length === 1
        && isSermonChurchReview(conflicts[0]) && request.baseline.metadata?.generation === stored.metadata?.generation
        && form.record.selection.some(path => equalValues(path, ['church'])) && !sameManualSelection(mine, stored.value, ['church']);
      const preparation = exact && stored.resource.collection === 'sermons' && conflicts.length === 1
        && request.baseline.metadata?.generation === stored.metadata?.generation ? conflicts[0] : undefined;
      const preparationField = preparation && form.record.selection.some(path => equalValues(path, preparation.path))
        && !sameManualSelection(mine, stored.value, preparation.path) ? reviewedSermonPreparationField(preparation) : undefined;
      const dateField = form.record.selection.some(path => equalValues(path, ['preachDates']))
        && request.baseline.metadata?.generation === stored.metadata?.generation && conflicts.some(({ path }) => {
          const versions = readPreachDateFieldVersions(path, mine, stored.value!);
          return versions && !equalValues(versions.mine, versions.stored);
        });
      // The server can prove that series text changed and returned to the same opening words.
      const observedSeriesConflicts = stored.resource.collection === 'series' && conflicts.some(isReturnedSeriesField)
        ? mergeDocumentFields(basis.value, reviewed, stored.value).conflicts.filter(item => !conflicts.some(({ path }) => equalValues(path, item.path))) : [];
      const seriesConflicts = [...conflicts, ...observedSeriesConflicts];
      const seriesFields = manualSeriesTextChoiceFields(request.baseline, stored, seriesConflicts, form.record.selection, mine);
      const seriesText = seriesFields && !sameManualSelection(mine, stored.value, [seriesFields[0]]);
      const hardQuestionComparison = exact && request.baseline.metadata?.generation === stored.metadata?.generation
        && request.result.conflicts.some(({ path }) => hardQuestionTextField(stored.resource.collection, path)
          && form.record.selection.some(selected => equalValues(selected, path)));
      const hardQuestionFields = hardQuestionComparison
        ? conflicts.flatMap(({ path }) => {
          const field = hardQuestionTextField(stored.resource.collection, path);
          return field && form.record.selection.some(selected => equalValues(selected, path))
            && !sameManualSelection(mine, stored.value, path) ? [field] : [];
        }) : undefined;
      const scriptureConflict = exact && request.baseline.metadata?.generation === stored.metadata?.generation
        ? conflicts.find(conflict => {
          const id = basisScriptureConflictId(conflict);
          return id && form.record.selection.some(selected => equalValues(selected, ['bases', { id }, 'scriptureRefs']));
        }) : undefined;
      const basisScripture = scriptureConflict
        ? compareBasisScripture(hardQuestionBasisScriptureId(scriptureConflict.path)!, reviewed ?? mine, stored.value,
          mergeDocumentFields(basis.value, reviewed ?? mine, stored.value).conflicts)
        : undefined;
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
      if (changed || seriesText || hardQuestionFields || basisScripture || exactPreparationText || exactVerse || returnedTitle || church || preparationField || dateField || exactThoughtText || exactList || outlineParent) {
        const comparedField = returnedTitle ? 'title' : exactVerse ? 'verse' : church ? 'church' : undefined;
        const headerReview = returnedTitle || returnedVerse || church;
        const reviewedFields = church
          ? withReviewedSermonChurchDates(basis.value, reviewed, stored.value, conflicts[0].mine, request.sermonChurchFill) : reviewed;
        const observedConflicts = comparedField && (headerReview || stored !== request.result.snapshot)
          ? mergeDocumentFields(headerReview ? basis.value : request.baseline.value, headerReview ? reviewedFields : mine, stored.value)
            .conflicts.filter(conflict => conflict.path[0] !== comparedField) : [];
        return { identity: JSON.stringify([form.record.scopeId, request.id, form.record.stage, stored]), requestId: request.id,
          conflictPaths: [...seriesConflicts, ...observedConflicts].map(conflict => conflict.path), mine,
          ...(returnedTitle && { kind: 'returned-sermon-title' as const }),
          ...(returnedVerse && { kind: 'returned-sermon-verse' as const }),
          ...(church && { kind: 'sermon-church' as const }),
          ...(preparationField && { preparationField }),
          ...(seriesText && seriesFields[0] !== 'description' && { returnedSeriesFields: seriesFields }),
          ...(hardQuestionFields && { hardQuestionFields }),
          ...(basisScripture && { basisScripture }),
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
