import { equalValues } from './fieldValues';
import { BASIS_FIELD_QUEUED, BASIS_FIELD_REVIEW, BASIS_FIELD_SETTLED, HARD_QUESTION_BASIS_POLICY } from './hardQuestionBasisFields';
import { metadataAfterBasisReferences, orderBasisReferences } from './hardQuestionBasisRefs.server';
import { hasBasisScripture } from './hardQuestionThemeLists';
import { matchesRowDetailBirth, rowDetailConflict } from './rowDetailAction';
import { metadataAfterRowDetails, needsLegacyRowDetailOpeningReview, orderRowDetails, readRowDetailProof } from './rowDetailOrder.server';
import { boundedRowId, existingRowField, existingRowFields } from './rowFieldAction';
import { readRowObservation } from './rowFieldOrder.server';
import { settledRowDetailComparisons } from './rowTextOrder.server';

import type { ConflictDetail, DataCommand, ResourceSnapshot } from './types';

const orderingPolicy: typeof HARD_QUESTION_BASIS_POLICY = {
  ...HARD_QUESTION_BASIS_POLICY,
  allowUnchanged: () => true,
  validAfter: (field, value) => field !== 'scriptureRefs' || hasBasisScripture(value),

};

function changedBasisChoice(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number, resolvedReferenceReview?: string): ConflictDetail[] {
  if (current.resource.collection !== HARD_QUESTION_BASIS_POLICY.collection || command.kind !== 'update' || !current.metadata
    || current.metadata.deleted || command.generation !== current.metadata.generation) return [];
  const { revision } = current.metadata;
  return HARD_QUESTION_BASIS_POLICY.fields.flatMap(field => {
    const submitted = command.hardQuestionBasisFieldActions?.[field];
    if (submitted?.reviewed !== true || (field === 'scriptureRefs' && submitted.rowId === resolvedReferenceReview)) return [];
    const target = HARD_QUESTION_BASIS_POLICY.target(field);
    const action = readRowObservation(command, submitted, target, serverMs, { allowUnclocked: true, allowUnchanged: () => true });
    if (!action || action.observedRevision > revision || !matchesRowDetailBirth(command.changes, submitted, HARD_QUESTION_BASIS_POLICY.birth)) return [];
    const rows = current.value?.bases;
    const saved = existingRowField(rows, action.rowId, target);
    if (saved !== undefined && equalValues(saved, action.after)) return [];
    const proof = saved === undefined ? undefined
      : readRowDetailProof(raw, orderingPolicy, field, action.rowId, submitted.rowCreatedAt, saved, undefined, revision);
    const stillShown = equalValues(saved, action.before) && (action.observedRevision === revision || (proof && proof.revision <= action.observedRevision));
    return stillShown ? [] : [rowDetailConflict(submitted, target, saved)];
  });
}

function legacyBasisChanges(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  if (command.resource.collection !== orderingPolicy.collection || command.kind !== 'update' || !current.metadata
    || current.metadata.deleted || command.generation !== current.metadata.generation) return [];
  const change = command.changes.find(item => item.path.length === 1 && item.path[0] === 'bases');
  if (!change) return [];
  const { revision } = current.metadata;
  return orderingPolicy.fields.flatMap(field => {
    if (field === 'scriptureRefs') return [];
    const target = orderingPolicy.target(field);
    const submitted = command.hardQuestionBasisFieldActions?.[field];
    const observed = readRowObservation(command, submitted, target, serverMs,
      { allowUnclocked: true, allowUnchanged: () => submitted?.reviewed === true });
    const before = existingRowFields(change.before.value, target);
    const after = existingRowFields(change.after.value, target);
    const saved = existingRowFields(current.value?.bases, target);
    return [...before].flatMap(([rowId, from]) => {
      const to = after.get(rowId), live = saved.get(rowId);
      if (!boundedRowId(rowId) || from === undefined || to === undefined || equalValues(from, to) || !equalValues(from, live)) return [];
      if (submitted && observed?.rowId === rowId && observed.observedRevision <= revision
        && matchesRowDetailBirth(command.changes, submitted, orderingPolicy.birth)) return [];
      return needsLegacyRowDetailOpeningReview(raw, orderingPolicy, field, rowId, rowId, from, revision)
        ? [rowDetailConflict({ rowId, rowCreatedAt: rowId, before: from, after: to, time: null, observedRevision: 0 }, target, live)] : [];
    });
  });
}

export function orderHardQuestionBasisFields(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  const references = orderBasisReferences(command, current, raw, serverMs);
  const ordered = orderRowDetails(references.command, current, raw, serverMs, orderingPolicy);
  const uncertain = [...ordered.uncertain, ...changedBasisChoice(command, current, raw, serverMs, references.resolvedReview),
    ...legacyBasisChanges(command, current, raw, serverMs), ...references.uncertain];
  const settled = settledRowDetailComparisons(command, current, orderingPolicy, ordered,
    { settled: BASIS_FIELD_SETTLED, queued: BASIS_FIELD_QUEUED })
    .filter(marker => !uncertain.some(conflict => equalValues(conflict.path, marker.path)));
  return { ...ordered, uncertain: uncertain.map(conflict => ({ ...conflict, code: BASIS_FIELD_REVIEW })),
    referenceWrite: references.proof, settled: [...settled, ...references.projections] };
}

export function metadataAfterHardQuestionBasisFields(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined,
  order?: ReturnType<typeof orderHardQuestionBasisFields>) {
  const metadata = metadataAfterRowDetails(snapshot, raw, orderingPolicy, order);
  const stamp = order?.fields.get('scriptureRefs')?.find(plan => plan.stamp)?.stamp;
  const referenceWrite = order?.referenceWrite ?? (stamp && { rowId: stamp.rowId, time: stamp.time, reaffirmed: [] });
  return metadataAfterBasisReferences({ ...snapshot, metadata }, raw, referenceWrite);
}
