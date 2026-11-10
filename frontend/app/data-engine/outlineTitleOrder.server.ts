import { createHash } from 'node:crypto';

import { documentProofHeadroom } from './documentProofBudget.server';
import { object } from './fieldValues';
import { outlinePlacementField } from './outlinePlacementResource';
import { outlineTitleChange, outlineTitlePath, outlineTitlePolicy, outlineTitleReview, OUTLINE_TITLE_QUEUED, OUTLINE_TITLE_REVIEW, OUTLINE_TITLE_SETTLED } from './outlineTitleAction';
import { isValidIdentifier } from './protocol';
import { matchesRowDetailBirth } from './rowDetailAction';
import { needsLegacyRowDetailOpeningReview, orderRowDetails } from './rowDetailOrder.server';
import { existingRowFields } from './rowFieldAction';
import { readRowObservation } from './rowFieldOrder.server';

import type { RowDetailObservation } from './rowDetailAction';
import type { ConflictDetail, DataCommand, EngineMetadata, ResourceSnapshot } from './types';

export function outlineTitleProofPolicy(collection: string) {
  const policy = outlineTitlePolicy(collection);
  if (policy) return { ...policy, proofRowId: (rowId: string) =>
    createHash('sha256').update(JSON.stringify(rowId)).digest('base64url') };
}

export function orderOutlineTitles(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  const field = outlinePlacementField(current.resource.collection);
  const policy = outlineTitleProofPolicy(current.resource.collection);
  const metadata = current.metadata;
  if (!policy || !field || command.kind !== 'update' || !metadata || metadata.deleted || command.generation !== metadata.generation) return;
  const change = outlineTitleChange(command.changes, field);
  if (!change) return;
  const target = policy.target('text');
  const accepted = new Map<string, RowDetailObservation<string> | undefined>();
  for (const submission of Array.isArray(command.outlineTitleActions) ? command.outlineTitleActions : []) {
    const action = readRowObservation(command, submission, target, serverMs, { allowUnclocked: true, allowUnchanged: () => true,
      acceptsRowId: policy.acceptsRowId });
    if (!action || action.observedRevision > metadata.revision || !object(submission) || submission.rowCreatedAt !== action.rowId
      || !matchesRowDetailBirth(command.changes, { rowId: action.rowId, rowCreatedAt: action.rowId }, policy.birth)) continue;
    accepted.set(action.rowId, accepted.has(action.rowId) ? undefined : {
      ...action, rowCreatedAt: action.rowId,
      ...(isValidIdentifier(submission.predecessorOperationId) && { predecessorOperationId: submission.predecessorOperationId }),
    });
  }
  const order = orderRowDetails({ ...command, outlineTitleActions: [...accepted.values()].filter(value => value !== undefined) },
    current, raw, serverMs, policy);
  const stored = current.value?.[field];
  const opening = existingRowFields(change.before.value, target);
  const proposed = existingRowFields(change.after.value, target);
  const live = existingRowFields(stored, target);
  const uncertain: ConflictDetail[] = [];
  for (const [id, after] of proposed) {
    const before = opening.get(id), saved = live.get(id);
    if (accepted.get(id) || before === undefined || after === undefined || before === after || before !== saved
      || !needsLegacyRowDetailOpeningReview(raw, policy, 'text', id, id, saved, metadata.revision)) continue;
    const path = outlineTitlePath(field, id, stored);
    if (path) uncertain.push(outlineTitleReview(path, before, after, saved));
  }
  for (const issue of order.uncertain) {
    const id = issue.path[1]?.slice(3);
    const path = id && outlineTitlePath(field, id, stored);
    uncertain.push(path ? { ...issue, path, code: OUTLINE_TITLE_REVIEW } : issue);
  }
  const settled = order.displaced.flatMap(entry => {
    const action = accepted.get(entry.rowId);
    const path = outlineTitlePath(field, entry.rowId, stored);
    const saved = live.get(entry.rowId);
    if (!action || !path || saved === undefined) return [];
    const code = saved === entry.winnerValue && action.after === entry.value ? OUTLINE_TITLE_SETTLED
      : saved === entry.value && action.after === entry.winnerValue ? OUTLINE_TITLE_QUEUED : undefined;
    return code ? [{ ...outlineTitleReview(path, action.before, action.after, saved), code }] : [];
  });
  return { ...order, uncertain, settled, policy };
}

/** A compacted title history leaves a revision floor that still protects older saves. */
export function boundOutlineTitleMetadata(value: Record<string, unknown>, metadata: EngineMetadata | null | undefined) {
  if (!metadata || !('outlineTitleRows' in metadata) || documentProofHeadroom(value, metadata) >= 0) return metadata;
  return { ...metadata, outlineTitleRows: { text: { floor: metadata.revision, proofs: [] } } };
}
