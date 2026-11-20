import { DOCUMENT_BOOKKEEPING_FIELDS } from '@/utils/documentBookkeeping';

import { equalValues, object, readField, writeField } from './fieldValues';
import { GROUP_BLOCK_STATUS_POLICY } from './groupBlockStatusAction';
import { GROUP_BLOCK_CONTENT_POLICY, GROUP_BLOCK_TITLE_POLICY, GROUP_STEP_NOTES_POLICY, GROUP_STEP_TITLE_POLICY } from './groupFlowTitleAction';
import { groupPlacementSteps } from './groupFlowTopology';
import { GROUP_STEP_DURATION_POLICY } from './groupStepDurationAction';
import { readPrivateFieldReview } from './privateFieldReview';
import { mergeDocumentFields } from './protocol';
import { existingRowField, replaceExistingRowField } from './rowFieldAction';

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

export function readGroupFlowFieldConflict(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate } = checkpoint;
  const review = readPrivateGroupTextReview(checkpoint) ?? readGroupTextReview(checkpoint);
  const next = review?.remaining[0];
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
  if (review && checkpoint.groupTextReview) {
    return { field: 'complete' as const, mine: null, stored: null, completion: true as const,
      identity: JSON.stringify([checkpoint.editGeneration, checkpoint.groupTextReview, remoteCandidate?.metadata?.revision]) };
  }
  if (checkpoint.conflicts.length !== 1 || checkpoint.groupTextReview) return undefined;
  const [conflict] = checkpoint.conflicts;
  // A return to the opening title is an explicit server comparison even though an ordinary value merge sees equality.
  if (confirmed.resource.collection === 'groups' && confirmed.metadata
    && confirmed.metadata.generation === remoteCandidate?.metadata?.generation && remoteCandidate.value && draft
    && Object.keys(checkpoint.pending).length === 1 && conflict.path.length === 1 && conflict.path[0] === 'title'
    && equalValues(conflict.base, conflict.theirs)) {
    const { title: mine } = draft;
    const { title: stored } = remoteCandidate.value;
    if (typeof mine === 'string' && typeof stored === 'string' && mine !== stored) {
      return { field: 'title' as const, mine, stored,
        identity: JSON.stringify([checkpoint.editGeneration, remoteCandidate.metadata.generation, remoteCandidate.metadata.revision, conflict.path, mine, stored]) };
    }
  }
  const description = readGroupDescriptionChoice(checkpoint, draft);
  if (description) return { field: description.field, mine: description.mine, stored: description.stored,
    identity: JSON.stringify([checkpoint.editGeneration, remoteCandidate?.metadata?.generation, remoteCandidate?.metadata?.revision,
      description.path, description.mine, description.stored]) };
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

type DescriptionChoice = GroupScalar & { field: 'description' };

function readGroupDescriptionChoice(checkpoint: SessionCheckpoint, draft: DocumentData | null): DescriptionChoice | undefined {
  const { confirmed, remoteCandidate, conflicts, pending } = checkpoint;
  if (confirmed.resource.collection !== 'groups' || !confirmed.value || !draft || !remoteCandidate?.value
    || !confirmed.metadata || confirmed.metadata.generation !== remoteCandidate.metadata?.generation
    || Object.keys(pending).length !== 1 || conflicts.length !== 1 || !equalValues(conflicts[0].path, ['description'])) return;
  const field = textAt({ ...checkpoint, draft }, conflicts[0].path);
  if (field?.field === 'description' && field.mine !== field.stored) return { ...field, field: 'description' };
}

function readGroupRowTextChoice(checkpoint: SessionCheckpoint, draft: DocumentData | null) {
  const versions = groupFlowFieldVersions(checkpoint, draft);
  return versions && (versions.field === 'content' || versions.field === 'notes') ? versions : undefined;
}

export function readGroupFlowTextChoice(checkpoint: SessionCheckpoint, draft = checkpoint.draft) {
  if (checkpoint.conflicts.length !== 1) return undefined;
  return readGroupDescriptionChoice(checkpoint, draft) ?? readGroupRowTextChoice(checkpoint, draft);
}

/** Replace only the compared text on the exact block or step it belonged to. */
export function writeGroupFlowTextChoice(value: DocumentData | null, choice: NonNullable<ReturnType<typeof readGroupFlowTextChoice>>,
  side: 'before' | 'mine' | 'stored'): DocumentData | undefined {
  if (!value) return undefined;
  if (choice.field === 'description') return writeGroupScalarChoice(value, choice, side);
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
  const linkedSteps = root === 'templates' && removedBy === 'local'
    ? groupPlacementSteps(checkpoint.remoteCandidate?.value?.flow)?.filter(step =>
      step.templateId === id && !findGroupRow(checkpoint.draft?.flow, step.id)
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

export function groupTextDecision(field: GroupText, side: GroupTextDecision['side']): GroupTextDecision {
  const { path, mine, stored } = field;
  return { path, birth: 'birth' in field ? field.birth : null, mine, stored, side, ...('row' in field && { row: field.row, removedBy: field.removedBy, ...(field.linkedSteps?.length && { linkedSteps: field.linkedSteps }) }) };
}

export function readPrivateGroupTextReview(checkpoint: SessionCheckpoint) {
  return checkpoint.confirmed.resource.collection === 'groups' ? readPrivateFieldReview(checkpoint, textAt) : undefined;
}

export function readGroupTextReview(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate, conflicts, pending, groupTextReview } = checkpoint;
  if (confirmed.resource.collection !== 'groups' || !confirmed.value || !draft || !remoteCandidate?.value
    || !confirmed.metadata || confirmed.metadata.generation !== remoteCandidate.metadata?.generation
    || Object.keys(pending).length !== 1 || !conflicts.length || groupTextReview?.separateDraft) return undefined;
  const merged = mergeDocumentFields(confirmed.value, draft, remoteCandidate.value);
  // A deleted row invalidates its prior text choice. A deletion that also conflicts
  // with local row work remains an explicit conflict, never a new live row.
  const paths = [...new Map([...conflicts, ...merged.conflicts].map(({ path }) => [JSON.stringify(path), path])).values()];
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
  const submittedDescription = conflicts.some(conflict => equalValues(conflict.path, ['description']));
  if (fields.some(field => !field) || (!groupTextReview && !submittedDescription
    && !fields.some(field => field?.field === 'content' || field?.field === 'notes'))) return undefined;
  const differing = fields.filter((field): field is GroupText => Boolean(field && (!('before' in field) || field.mine !== field.stored)));
  const decisions = (groupTextReview?.decisions ?? []).filter(decision => differing.some(field =>
    equalValues(decision, groupTextDecision(field, decision.side))));
  const remaining = differing.filter(field => !decisions.some(decision => equalValues(decision.path, field.path)));
  return { fields: differing, decisions, remaining, merged, stored: remoteCandidate.value };
}

export function projectGroupTextDecisions(review: Pick<NonNullable<ReturnType<typeof readGroupTextReview>>, 'fields' | 'merged' | 'stored'>,
  decisions: readonly FieldSelection[]): DocumentData | undefined {
  if (!review.merged.value.exists) return undefined;
  let value = review.merged.value.value as DocumentData;
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
        value = { ...value, [root]: rows.filter(item => !object(item) || item.id !== id) };
      } else if (!findGroupRow(rows, id)) {
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
          value = { ...value, flow: flow.map((step, index) => ({ ...step, order: index + 1 })) };
        }
      }
    } else {
      const reviewed = writeGroupFlowTextChoice(value, field, side);
      if (!reviewed) return undefined;
      value = reviewed;
    }
  }
  return value;
}
