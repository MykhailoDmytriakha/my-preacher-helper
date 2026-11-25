import { DOCUMENT_BOOKKEEPING_FIELDS } from '@/utils/documentBookkeeping';

import { groupStatusOutsideChoice } from './documentFieldAction';
import { equalValues, object, readField, writeField } from './fieldValues';
import { GROUP_BLOCK_STATUS_POLICY } from './groupBlockStatusAction';
import { GROUP_BLOCK_CONTENT_POLICY, GROUP_BLOCK_TITLE_POLICY, GROUP_FLOW_TEXT_QUEUED, GROUP_FLOW_TEXT_SETTLED, GROUP_STEP_NOTES_POLICY, GROUP_STEP_TITLE_POLICY, isOrderedGroupFlowText } from './groupFlowTitleAction';
import { GROUP_FLOW_COPY_CONTENT_MISSING, groupPlacementSteps } from './groupFlowTopology';
import { privateGroupCopyFields, projectPrivateGroupCopies, type PrivateGroupCopy } from './groupPrivateCopyReview';
import { GROUP_STEP_DURATION_POLICY } from './groupStepDurationAction';
import { mergeGroupFlowRebase, restoreGroupPlacementOrder } from './groupStepPlacement';
import { privateFieldsForPaths, readPrivateFieldReview } from './privateFieldReview';
import { mergeDocumentFields } from './protocol';
import { existingRowField, replaceExistingRowField, rowConflictValue } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { CouncilOutcome } from './councilOutcomeAction';
import type { FieldSelection } from './privateFieldReview';
import type { RowFieldTarget } from './rowFieldAction';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData } from './types';

const groupFlowFields = {
  block: { birth: GROUP_BLOCK_TITLE_POLICY.birth, target: GROUP_BLOCK_TITLE_POLICY.target('title') },
  step: { birth: GROUP_STEP_TITLE_POLICY.birth, target: GROUP_STEP_TITLE_POLICY.target('title') },
  status: { birth: GROUP_BLOCK_STATUS_POLICY.birth, target: GROUP_BLOCK_STATUS_POLICY.target('status') },
  duration: { birth: GROUP_STEP_DURATION_POLICY.birth, target: GROUP_STEP_DURATION_POLICY.target('durationMin') },
  content: { birth: GROUP_BLOCK_CONTENT_POLICY.birth, target: GROUP_BLOCK_CONTENT_POLICY.target('content') },
  notes: { birth: GROUP_STEP_NOTES_POLICY.birth, target: GROUP_STEP_NOTES_POLICY.target('instanceNotes') },
} as const;

function groupFlowFieldVersions(checkpoint: SessionCheckpoint, draft: DocumentData | null, path = checkpoint.conflicts[0]?.path) {
  const { confirmed, remoteCandidate, pending } = checkpoint;
  const privateProof = checkpoint.unreadableScalarProof?.length || checkpoint.unreadableRowProofs?.length;
  if (confirmed.resource.collection !== 'groups' || !confirmed.value || !draft
    || !path || Object.keys(pending).length !== (privateProof ? 0 : 1)
    || !remoteCandidate?.value || remoteCandidate.metadata?.generation !== confirmed.metadata?.generation) return undefined;
  if (path.length !== 3 || !path[1].startsWith('id:')) return undefined;
  const comparisonField = (Object.keys(groupFlowFields) as Array<keyof typeof groupFlowFields>).find(field => {
    const { target } = groupFlowFields[field];
    return target.field === path[0] && target.leaf === path[2];
  });
  if (!comparisonField) return undefined;
  const { birth: birthTarget, target }: { birth: RowFieldTarget<string>; target: RowFieldTarget<string | number | null> } = groupFlowFields[comparisonField];
  const id = path[1].slice(3);
  const birth = existingRowField(confirmed.value[target.field], id, birthTarget);
  const before = existingRowField(confirmed.value[target.field], id, target);
  const mine = existingRowField(draft[target.field], id, target);
  const stored = existingRowField(remoteCandidate.value[target.field], id, target);
  if (birth === undefined || before === undefined || mine === undefined || stored === undefined
    || existingRowField(draft[target.field], id, birthTarget) !== birth
    || existingRowField(remoteCandidate.value[target.field], id, birthTarget) !== birth) return undefined;
  return { field: comparisonField, target, birthTarget, birth, id, path, before, mine, stored };
}

const withoutBookkeeping = (value: DocumentData) => Object.fromEntries(
  Object.entries(value).filter(([key]) => !DOCUMENT_BOOKKEEPING_FIELDS.has(key)));

function findGroupRow(rows: DocumentData[string] | undefined, id: string): DocumentData | undefined {
  return Array.isArray(rows) ? rows.find((row): row is DocumentData => object(row) && row.id === id) : undefined;
}

function returnedGroupTitle(conflict: ConflictDetail): boolean {
  return equalValues(conflict.path, ['title']) && equalValues(conflict.base, conflict.theirs);
}

export function readGroupFlowFieldConflict(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate } = checkpoint;
  const review = readPrivateGroupTextReview(checkpoint) ?? readGroupTextReview(checkpoint);
  const next = review?.remaining[0];
  if (next?.field === 'copiedSteps') {
    return { field: next.field, mine: next.mine, stored: next.stored, rowTitle: next.template.title,
      blockWords: next.blockWords, steps: next.steps, sourcePresent: next.storedTemplate?.createdAt === next.birth,
      identity: JSON.stringify([checkpoint.editGeneration, remoteCandidate?.metadata, checkpoint.privateFieldReview, next.path, next.witness]) };
  }
  if (next) {
    const { field, mine, stored, path } = next;
    const row = 'row' in next ? next.row : 'id' in next
      ? next.target.field === 'templates'
        ? findGroupRow(draft?.templates, next.id)
        : findGroupRow(draft?.flow, next.id) : undefined;
    const template = row && typeof row.templateId === 'string' ? findGroupRow(draft?.templates, row.templateId) : undefined;
    const rowTitle = [row?.instanceTitle, row?.title, template?.title].find(value => typeof value === 'string' && value.trim());
    const rowId = 'id' in next ? next.id : 'row' in next ? next.path[1].slice(3) : undefined;
    const blocks = draft?.templates;
    const flow = draft?.flow;
    const firstStep = path[0] === 'templates' && rowId && Array.isArray(flow)
      ? flow.find(item => object(item) && item.templateId === rowId) : undefined;
    const blockIndex = path[0] === 'templates' && Array.isArray(blocks)
      ? blocks.findIndex(item => object(item) && item.id === rowId) : -1;
    const rowPosition = row?.order ?? (object(firstStep) ? firstStep.order : undefined) ?? (blockIndex >= 0 ? blockIndex + 1 : undefined);
    return { field, mine, stored, rowTitle: typeof rowTitle === 'string' ? rowTitle : undefined,
      rowPosition: typeof rowPosition === 'number' ? rowPosition : undefined, rowId,
      removedBy: 'row' in next ? next.removedBy : undefined,
      identity: JSON.stringify([checkpoint.editGeneration, checkpoint.groupTextReview, checkpoint.privateFieldReview,
      remoteCandidate?.metadata?.generation, remoteCandidate?.metadata?.revision, path, mine, stored, 'row' in next && next.row]) };
  }
  if (review && (checkpoint.groupTextReview || review.settled.length)) {
    return { field: 'complete' as const, mine: null, stored: null, completion: true as const,
      identity: JSON.stringify([checkpoint.editGeneration, checkpoint.groupTextReview, remoteCandidate?.metadata?.revision]) };
  }
  if (checkpoint.conflicts.length !== 1 || checkpoint.groupTextReview) return undefined;
  const [conflict] = checkpoint.conflicts;
  // A return to the opening title is an explicit server comparison even though an ordinary value merge sees equality.
  if (confirmed.resource.collection === 'groups' && confirmed.metadata
    && confirmed.metadata.generation === remoteCandidate?.metadata?.generation && remoteCandidate.value && draft
    && Object.keys(checkpoint.pending).length === 1 && returnedGroupTitle(conflict)) {
    const { title: mine } = draft;
    const { title: stored } = remoteCandidate.value;
    if (typeof mine === 'string' && typeof stored === 'string' && mine !== stored) {
      return { field: 'title' as const, mine, stored,
        identity: JSON.stringify([checkpoint.editGeneration, remoteCandidate.metadata.generation, remoteCandidate.metadata.revision, conflict.path, mine, stored]) };
    }
  }
  const scalar = readGroupScalarTextChoice(checkpoint, draft);
  if (scalar) return { field: scalar.field, mine: scalar.mine, stored: scalar.stored,
    identity: JSON.stringify([checkpoint.editGeneration, remoteCandidate?.metadata?.generation, remoteCandidate?.metadata?.revision,
      scalar.path, scalar.mine, scalar.stored]) };
  const versions = groupFlowFieldVersions(checkpoint, draft);
  if (!versions || versions.mine === versions.stored || !draft || !confirmed.value || !remoteCandidate) return undefined;
  const { field, target, id, path, before, mine, stored } = versions;
  const compared = (value: DocumentData) => {
    const rows = replaceExistingRowField(value[target.field], id, before, target);
    const normalized = target.field === 'templates' && Array.isArray(rows) ? rows.map(row => object(row) && row.id === id
      ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'updatedAt')) : row) : rows;
    return { ...withoutBookkeeping(value), [target.field]: normalized };
  };
  if (!checkpoint.unreadableRowProofs?.length && field !== 'content' && field !== 'notes'
    && !equalValues(compared(confirmed.value), compared(draft))) return undefined;
  return { field, mine, stored,
    identity: JSON.stringify([checkpoint.editGeneration, remoteCandidate.metadata?.generation, remoteCandidate.metadata?.revision, path, mine, stored]) };
}

export function isGroupStatusComparison({ path, code }: ConflictDetail): boolean {
  return !code && equalValues(path, ['status']);
}

function readGroupScalarTextChoice(checkpoint: SessionCheckpoint, draft: DocumentData | null): GroupScalar | undefined {
  const { confirmed, remoteCandidate, conflicts, pending } = checkpoint;
  if (confirmed.resource.collection !== 'groups' || !confirmed.value || !draft || !remoteCandidate?.value
    || !confirmed.metadata || confirmed.metadata.generation !== remoteCandidate.metadata?.generation
    || Object.keys(pending).length !== 1 || conflicts.length !== 1) return;
  const [conflict] = conflicts;
  const field = textAt({ ...checkpoint, draft }, conflict.path);
  if ((field?.field === 'description' || (field?.field === 'title' && returnedGroupTitle(conflict))
    || (field?.field === 'groupStatus' && isGroupStatusComparison(conflict))) && 'before' in field && field.mine !== field.stored) {
    return field;
  }
}

function isGroupRowText(field: string | undefined) {
  return field === 'content' || field === 'notes' || field === 'block' || field === 'step';
}

function readGroupRowTextChoice(checkpoint: SessionCheckpoint, draft: DocumentData | null) {
  const versions = groupFlowFieldVersions(checkpoint, draft);
  return versions && isGroupRowText(versions.field) ? versions : undefined;
}

export function readGroupFlowTextChoice(checkpoint: SessionCheckpoint, draft = checkpoint.draft) {
  if (checkpoint.conflicts.length !== 1) return undefined;
  return readGroupScalarTextChoice(checkpoint, draft) ?? readGroupRowTextChoice(checkpoint, draft);
}

/** Replace only the compared text on the exact block or step it belonged to. */
export function writeGroupFlowTextChoice(value: DocumentData | null, choice: GroupScalar | RowText,
  side: 'before' | 'mine' | 'stored'): DocumentData | undefined {
  if (!value) return undefined;
  if (!('target' in choice)) return writeGroupScalarChoice(value, choice, side);
  const { target, birthTarget, birth, id } = choice;
  if (existingRowField(value[target.field], id, birthTarget) !== birth
    || existingRowField(value[target.field], id, target) === undefined) return undefined;
  const rows = replaceExistingRowField(value[target.field], id, choice[side], target);
  return rows === undefined ? undefined : { ...value, [target.field]: rows };
}

type RowText = NonNullable<ReturnType<typeof readGroupRowTextChoice>>;
type GroupScalar = {
  field: 'description' | 'title' | 'groupStatus';
  path: string[];
  before: string | null;
  mine: string | null;
  stored: string | null;
};
function writeGroupScalarChoice(value: DocumentData, choice: GroupScalar, side: 'before' | 'mine' | 'stored'): DocumentData {
  const words = choice[side];
  return writeField(value, choice.path, words === null ? { exists: false } : { exists: true, value: words });
}

type RemovedGroupText = {
  field: 'removedContent' | 'removedNotes';
  path: string[];
  birth: string;
  mine: string | null;
  stored: string | null;
  removedBy: 'local' | 'remote';
  row: DocumentData;
  linkedSteps?: DocumentData[];
};
type GroupText = RowText | GroupScalar | RemovedGroupText;

export function sameGroupText(before: DocumentData, after: DocumentData, field: GroupText): boolean {
  if ('target' in field) {
    const { id, target, birthTarget } = field;
    return existingRowField(before[target.field], id, birthTarget) === existingRowField(after[target.field], id, birthTarget)
      && equalValues(existingRowField(before[target.field], id, target), existingRowField(after[target.field], id, target));
  }
  if ('row' in field) {
    const [root, row] = field.path;
    return equalValues(findGroupRow(before[root], row.slice(3)), findGroupRow(after[root], row.slice(3)));
  }
  return equalValues(readField(before, field.path), readField(after, field.path));
}


/** The terminal Save owns this staged review, so any editor can reopen the same draft. */
export interface GroupTextReviewStage {
  checkpoint: Omit<SessionCheckpoint, 'groupTextReview'>;
  decisions: GroupTextDecision[];
}

export interface GroupTextDecision {
  path: string[];
  birth: string | null;
  mine: string | number | boolean | CouncilOutcome | null;
  stored: string | number | boolean | CouncilOutcome | null;
  side: 'local' | 'remote';
  time?: ActionTime | null;
  row?: DocumentData;
  removedBy?: 'local' | 'remote';
  linkedSteps?: DocumentData[];
}

function removedText(checkpoint: SessionCheckpoint, conflict: ConflictDetail): RemovedGroupText | undefined {
  const [root, row] = conflict.path;
  if (conflict.path.length !== 2 || !row?.startsWith('id:') || !conflict.base.exists || conflict.mine.exists === conflict.theirs.exists) return undefined;
  const removedBy = conflict.mine.exists ? 'remote' : 'local';
  const present = removedBy === 'remote' ? conflict.mine : conflict.theirs;
  const policy = root === 'templates' ? groupFlowFields.content : root === 'flow' ? groupFlowFields.notes : undefined;
  if (!policy || !object(conflict.base.value) || !object(present.value)) return undefined;
  const before = conflict.base.value, draft = present.value;
  const id = row.slice(3);
  const birth = existingRowField([before], id, policy.birth);
  if (birth === undefined || existingRowField([draft], id, policy.birth) !== birth) return undefined;
  const mine = existingRowField([draft], id, policy.target);
  if (mine === undefined) return undefined;
  const otherFields = root === 'templates' ? [groupFlowFields.block, groupFlowFields.status] : [groupFlowFields.step, groupFlowFields.duration];
  const changes = otherFields.flatMap(({ target }) => {
    const previous = existingRowField([before], id, target as RowFieldTarget<string | number | null>);
    const latest = existingRowField([draft], id, target as RowFieldTarget<string | number | null>);
    return previous === latest ? [] : [latest];
  });
  const words = changes.length ? [mine, ...changes].filter(value => value !== null && value !== undefined).join('\n') : mine;
  const absent = removedBy === 'remote' ? checkpoint.remoteCandidate?.value?.[root] : checkpoint.draft?.[root];
  if (findGroupRow(absent, id)) return undefined;
  const presentDocument = removedBy === 'local' ? checkpoint.remoteCandidate?.value : checkpoint.draft;
  const absentDocument = removedBy === 'local' ? checkpoint.draft : checkpoint.remoteCandidate?.value;
  const linkedSteps = root === 'templates' ? groupPlacementSteps(presentDocument?.flow)?.filter(step =>
    step.templateId === id && !findGroupRow(absentDocument?.flow, step.id)
    && findGroupRow(checkpoint.confirmed.value?.flow, step.id)?.templateId === id) : undefined;
  return { field: root === 'templates' ? 'removedContent' : 'removedNotes', path: conflict.path, birth,
    mine: removedBy === 'remote' ? words : null, stored: removedBy === 'local' ? words : null, removedBy, row: draft, linkedSteps };
}

function textAt(checkpoint: SessionCheckpoint, path: string[]): GroupText | undefined {
  const [key] = path;
  if (path.length === 1 && (key === 'description' || key === 'title' || key === 'status')) {
    const values = [checkpoint.confirmed.value, checkpoint.draft, checkpoint.remoteCandidate?.value].map(value => {
      const field = value && readField(value, path);
      return !field?.exists && key === 'description' ? null : typeof field?.value === 'string' ? field.value : undefined;
    });
    const [before, mine, stored] = values;
    return before !== undefined && mine !== undefined && stored !== undefined
      ? { field: key === 'status' ? 'groupStatus' : key, path, before, mine, stored } : undefined;
  }
  return groupFlowFieldVersions(checkpoint, checkpoint.draft, path);
}

export function groupTextDecision(field: GroupText, side: GroupTextDecision['side'], time?: ActionTime | null): GroupTextDecision {
  const { path, mine, stored } = field;
  return { path, birth: 'birth' in field ? field.birth : null, mine, stored, side, ...(time !== undefined && { time }),
    ...('row' in field && { row: field.row, removedBy: field.removedBy, ...(field.linkedSteps?.length && { linkedSteps: field.linkedSteps }) }) };
}

/** A deleted block and its linked removed steps form one choice. Keep the words from each visible. */
function removedParentOfLocalStep(checkpoint: SessionCheckpoint, field: RemovedGroupText, merged: DocumentData) {
  const { templateId } = field.row;
  if (field.field !== 'removedNotes' || field.removedBy !== 'local' || typeof templateId !== 'string'
    || findGroupRow(checkpoint.draft?.templates, templateId)) return;
  if (groupPlacementSteps(merged.flow)?.some(step => step.templateId === templateId)) return;
  const before = findGroupRow(checkpoint.confirmed.value?.templates, templateId);
  const stored = findGroupRow(checkpoint.remoteCandidate?.value?.templates, templateId);
  if (!before || !stored) return;
  return removedText(checkpoint, { path: ['templates', 'id:' + templateId],
    base: { exists: true, value: before }, mine: { exists: false }, theirs: { exists: true, value: stored } });
}

/** With a single opening step, its retirement and the block's retirement were one deletion. */
function onlyRetiredStep(checkpoint: SessionCheckpoint, field: RemovedGroupText) {
  if (field.removedBy !== 'local' || field.field !== 'removedContent') return;
  const blockId = field.path[1].slice(3);
  const openingSteps = groupPlacementSteps(checkpoint.confirmed.value?.flow)?.filter(step => step.templateId === blockId);
  if (openingSteps?.length === 1) return field.linkedSteps?.find(step => step.id === openingSteps[0].id);
}

function privateGroupFields(checkpoint: SessionCheckpoint, conflicts: readonly ConflictDetail[], merged: DocumentData,
  copies: readonly PrivateGroupCopy[]) {
  const copyAt = (path: string[]) => path[0] === 'templates' && copies.find(copy => path[1] === copy.path[1]
    && (equalValues(path, copy.path) || copy.storedTemplate?.createdAt !== copy.birth));
  const removed = conflicts.flatMap(conflict => copyAt(conflict.path) ? [] : removedText(checkpoint, conflict) ?? []);
  const parents = removed.flatMap(field => removedParentOfLocalStep(checkpoint, field, merged) ?? []);
  const scopes = [...new Map([...parents, ...removed].map(field => [JSON.stringify(field.path), field])).values()];
  const onRow = (path: string[], row: RemovedGroupText) => equalValues(path.slice(0, 2), row.path);
  const linkedTo = (path: string[], row: RemovedGroupText) =>
    path[0] === 'flow' && row.linkedSteps?.some(step => path[1] === 'id:' + step.id);
  return privateFieldsForPaths(conflicts, path => {
    const copy = copyAt(path);
    if (copy) return copy;
    const field = scopes.find(row => onRow(path, row));
    if (!field) return textAt(checkpoint, path);
    const side = field.removedBy === 'local' ? 'stored' : 'mine';
    const linked = scopes.filter(item => item.removedBy === field.removedBy && linkedTo(item.path, field));
    const only = linked.length ? undefined : onlyRetiredStep(checkpoint, field);
    const linkedSteps = only ? [only] : field.linkedSteps?.filter(step => linked.some(item => item.path[1] === 'id:' + step.id));
    const words = only ? [only.instanceTitle, only.instanceNotes].filter((word): word is string => typeof word === 'string' && Boolean(word))
      : linked.flatMap(item => item[side] ?? []);
    return { ...field, linkedSteps, ...(words.length && { [side]: [field[side], ...words].filter(value => value !== null).join('\n') }) };
  }, path => {
    const copy = copyAt(path);
    return copy ? copy.path : scopes.find(row => linkedTo(path, row))?.path ?? scopes.find(row => onRow(path, row))?.path ?? path;
  });
}

export function readPrivateGroupTextReview(checkpoint: SessionCheckpoint) {
  if (checkpoint.confirmed.resource.collection !== 'groups') return undefined;
  const copies = privateGroupCopyFields(checkpoint);
  if (!copies) return undefined;
  const conflicts = checkpoint.conflicts.map(conflict => conflict.code === GROUP_FLOW_COPY_CONTENT_MISSING
    && copies.some(copy => equalValues(copy.path.slice(0, 2), conflict.path)) ? { ...conflict, code: undefined } : conflict);
  const review = readPrivateFieldReview({ ...checkpoint, conflicts }, (conflicts, merged) => {
    const fields = privateGroupFields(checkpoint, conflicts, merged, copies);
    return [...fields.filter(field => field?.field !== 'copiedSteps'), ...copies];
  }, mergeGroupFlowRebase, copies.length > 0);
  return review && { ...review, settled: [], groupCopySources: copies.map(copy => copy.template.id) };
}

export function projectPrivateGroupFields(review: NonNullable<ReturnType<typeof readPrivateGroupTextReview>>,
  decisions: readonly FieldSelection[]): DocumentData | undefined {
  const fields = review.fields.filter(field => field.field !== 'copiedSteps');
  const value = projectGroupTextDecisions({ ...review, fields }, decisions);
  if (!value) return;
  return projectPrivateGroupCopies(value, review.fields.filter(field => field.field === 'copiedSteps'), decisions);
}

export function readGroupTextReview(source: SessionCheckpoint) {
  const { confirmed, remoteCandidate, conflicts, pending, groupTextReview } = source;
  const requests = Object.entries(pending).sort(([, first], [, second]) => first.generation - second.generation);
  const [requestId, first] = requests[0] ?? [];
  const useSubmittedFrame = first && (requests.length > 1 || conflicts.some(({ code }) => isOrderedGroupFlowText(code)));
  const checkpoint = useSubmittedFrame ? { ...source, draft: first.value, pending: { [requestId]: first } } : source;
  const { draft } = checkpoint;
  if (confirmed.resource.collection !== 'groups' || !confirmed.value || !draft || !remoteCandidate?.value
    || !confirmed.metadata || confirmed.metadata.generation !== remoteCandidate.metadata?.generation
    || !requestId || !conflicts.length || groupTextReview?.separateDraft
    || (groupTextReview && groupTextReview.requestId !== requestId)) return undefined;
  const settled = new Map<string, { field: GroupScalar | RowText; side: 'mine' | 'stored' }>();
  let proposed = draft;
  for (const conflict of conflicts) {
    const side = conflict.code === GROUP_FLOW_TEXT_SETTLED ? 'stored' : conflict.code === GROUP_FLOW_TEXT_QUEUED ? 'mine' : undefined;
    if (!side) continue;
    const field = textAt(checkpoint, conflict.path);
    if (!field || !('before' in field) || !equalValues(conflict.base, rowConflictValue(field.before))
      || !equalValues(conflict.mine, rowConflictValue(field.mine))) continue;
    settled.set(JSON.stringify(conflict.path), { field, side });
    if (side === 'stored') {
      const accepted = writeGroupFlowTextChoice(proposed, field, side);
      if (!accepted) return undefined;
      proposed = accepted;
    }
  }
  const merged = mergeDocumentFields(confirmed.value, proposed, remoteCandidate.value);
  // A deleted row invalidates its prior text choice. A deletion that also conflicts
  // with local row work remains an explicit conflict, never a new live row.
  const separateStatus = groupStatusOutsideChoice(checkpoint, requestId);
  const paths = [...new Map([...conflicts, ...merged.conflicts].map(({ path }) => [JSON.stringify(path), path]))]
    .flatMap(([key, path]) => settled.has(key) || (separateStatus && equalValues(path, ['status'])) ? [] : [path]);
  const removed = merged.conflicts.flatMap(conflict => removedText(checkpoint, conflict) ?? []);
  const fields = paths.filter(path => {
    if (removed.some(item => item.path.length < path.length && equalValues(item.path, path.slice(0, item.path.length)))) return false;
    if (!groupTextReview || path.length !== 3 || !path[1].startsWith('id:')) return true;
    const id = path[1].slice(3);
    const rows = merged.value.exists && object(merged.value.value) ? merged.value.value[path[0]] : undefined;
    // The current merge already took a clean deletion, so the old leaf no longer asks a question.
    return !Array.isArray(rows) || rows.some(row => object(row) && row.id === id)
      || merged.conflicts.some(conflict => equalValues(conflict.path, path.slice(0, 2)));
  }).map(path => removed.find(item => equalValues(item.path, path)) ?? textAt(checkpoint, path));
  const submittedScalar = conflicts.some(conflict => equalValues(conflict.path, ['description'])
    || returnedGroupTitle(conflict) || isGroupStatusComparison(conflict));
  if (fields.some(field => !field) || (!groupTextReview && !submittedScalar && !settled.size
    && !fields.some(field => isGroupRowText(field?.field)))) return undefined;
  const differing = fields.filter((field): field is GroupText => Boolean(field && (!('before' in field) || field.mine !== field.stored)));
  const decisions = (groupTextReview?.decisions ?? []).filter(decision => differing.some(field =>
    equalValues(decision, groupTextDecision(field, decision.side, decision.time))));
  const remaining = differing.filter(field => !decisions.some(decision => equalValues(decision.path, field.path)));
  return { requestId, fields: differing, decisions, remaining, merged, stored: remoteCandidate.value, settled: [...settled.values()] };
}

export function projectGroupTextDecisions(review: Pick<NonNullable<ReturnType<typeof readGroupTextReview>>, 'fields' | 'merged' | 'stored' | 'settled'>,
  decisions: readonly FieldSelection[]): DocumentData | undefined {
  if (!review.merged.value.exists) return undefined;
  let value = review.merged.value.value as DocumentData;
  for (const { field, side } of review.settled) {
    const reviewed = writeGroupFlowTextChoice(value, field, side);
    if (!reviewed) return undefined;
    value = reviewed;
  }
  for (const field of review.fields) {
    const decision = decisions.find(item => equalValues(item.path, field.path));
    if (!decision) return undefined;
    const side = decision.side === 'local' ? 'mine' : 'stored';
    if (!('target' in field) && 'before' in field) {
      value = writeGroupScalarChoice(value, field, side);
    } else if (!('before' in field)) {
      if (field.removedBy === 'remote' && decision.side !== 'remote') return undefined;
      const [root, row] = field.path;
      const id = row.slice(3);
      const rows = value[root];
      if (!Array.isArray(rows)) return undefined;
      if (field.removedBy === decision.side) {
        if (root === 'templates') {
          const flow = value.flow === undefined ? [] : groupPlacementSteps(value.flow);
          if (!flow) return undefined;
          const removed = new Set(field.linkedSteps?.map(step => step.id));
          const kept = flow.filter(step => !removed.has(step.id));
          if (kept.length !== flow.length) value = restoreGroupPlacementOrder({ ...value, flow: kept })!;
          // An independently surviving step still owns its block.
          if (kept.some(step => step.templateId === id)) {
            if (!findGroupRow(rows, id)) return undefined;
            continue;
          }
        }
        value = { ...value, [root]: rows.filter(item => !object(item) || item.id !== id) };
      } else if (!findGroupRow(rows, id)) {
        if (root === 'flow' && (typeof field.row.templateId !== 'string' || !findGroupRow(value.templates, field.row.templateId))) return undefined;
        const acceptedRows = review.stored[root];
        if (!Array.isArray(acceptedRows)) return undefined;
        const index = acceptedRows.findIndex(item => object(item) && item.id === id);
        const after = acceptedRows.slice(index + 1).find(item => object(item) && typeof item.id === 'string' && findGroupRow(rows, item.id));
        const at = object(after) ? rows.findIndex(item => object(item) && item.id === after.id) : rows.length;
        value = { ...value, [root]: [...rows.slice(0, at), field.row, ...rows.slice(at)] };
        if (field.linkedSteps?.length) {
          const flow = groupPlacementSteps(value.flow);
          const savedFlow = groupPlacementSteps(review.stored.flow);
          if (!flow || !savedFlow) return undefined;
          // Insert at the saved neighbors. A local deletion may have reused its old order number.
          const linked = new Set(field.linkedSteps.map(step => step.id));
          for (const [index, saved] of savedFlow.entries()) {
            if (!linked.has(saved.id) || flow.some(step => step.id === saved.id)) continue;
            const following = savedFlow.slice(index + 1).find(row => flow.some(step => step.id === row.id));
            const previous = savedFlow.slice(0, index).findLast(row => flow.some(step => step.id === row.id));
            const at = following ? flow.findIndex(step => step.id === following.id)
              : previous ? flow.findIndex(step => step.id === previous.id) + 1 : flow.length;
            flow.splice(at, 0, saved);
          }
          value = restoreGroupPlacementOrder({ ...value, flow })!;
        }
      }
      if (root === 'flow') value = restoreGroupPlacementOrder(value)!;
    } else {
      const reviewed = writeGroupFlowTextChoice(value, field, side);
      if (!reviewed) return undefined;
      value = reviewed;
    }
  }
  return value;
}
