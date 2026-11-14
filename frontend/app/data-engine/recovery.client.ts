'use client';

import { z } from 'zod';

import { ACCOUNT_PREFERENCE_TARGETS, type AccountPreferenceField } from './accountPreference';
import { orderActionProjections } from './atomicCommits';
import { readManualScopeIdentity } from './editorIdentity';
import { outlinePlacementField } from './outlinePlacementResource';
import { equalValues, getResourcePolicy, isValidIdentifier, validateCommand } from './protocol';
import { recoverySources } from './recoveryPresence';
import { recoveryOrigins } from './recoverySource';
import { DataSession } from './session';
import { isThoughtLocation, type ThoughtLocation } from './thoughtPlacementAction';
import { serviceOrderPlacementComparisonSchema, snapshotSchema } from './transport.client';

import type { CommitRequest } from './commits';
import type { CheckpointRecoveryStore, EditorRecord, RecoveryCheckpoint } from './controller';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, FieldValue, ResourceRef } from './types';

const id = z.string().refine(isValidIdentifier);
const fieldSchema = z.discriminatedUnion('exists', [z.object({ exists: z.literal(false) }), z.object({ exists: z.literal(true), value: z.unknown() })]);
const groupPlacementWitness = z.array(z.object({ id, templateId: id }));
const groupPlacementGap = z.object({ previous: id.nullable(), next: id.nullable() });
const groupPlacementCapture = z.object({
  generation: id.nullable(), before: groupPlacementWitness, after: groupPlacementWitness,
  placement: z.object({ stepId: id, opening: groupPlacementGap, destination: groupPlacementGap,
    observedRevision: z.number().int().safe().nonnegative(), time: z.object({
      earliestMs: z.number().finite(), latestMs: z.number().finite(),
    }).nullable(), predecessorOperationId: id.optional(), queueId: id.optional() }),
});
const councilWitness = z.array(z.object({ id }));
const councilPlacementCapture = groupPlacementCapture.extend({ before: councilWitness, after: councilWitness });
const actionTime = z.object({ earliestMs: z.number().finite(), latestMs: z.number().finite() })
  .refine(time => time.earliestMs <= time.latestMs).nullable();
const observedRevision = z.number().int().safe().nonnegative();
const commentPlaceObservation = z.object({ before: fieldSchema, after: fieldSchema, paragraph: fieldSchema,
  observedRevision: observedRevision.positive(), time: actionTime, predecessorOperationId: id.optional(),
  compound: z.literal(true).optional(), reviewed: z.literal(true).optional() });
const outlineSection = z.enum(['introduction', 'main', 'conclusion']);
const outlineGap = groupPlacementGap.extend({ section: outlineSection });
const outlineWitness = z.object({ introduction: councilWitness, main: councilWitness, conclusion: councilWitness });
const outlinePlacement = z.object({ generation: id.nullable(), before: outlineWitness, after: outlineWitness,
  placement: z.object({ pointId: id, opening: outlineGap, destination: outlineGap, observedRevision, time: actionTime, predecessorOperationId: id.optional() }),
});
const fieldAction = z.object({ observedRevision, time: actionTime, predecessorOperationId: id.optional() });
const textAction = fieldAction.extend({ before: z.string(), after: z.string() });
const groupFieldDraft = z.object({ generation: id, action: textAction });
const rowAction = fieldAction.extend({ rowId: z.string().min(1), rowCreatedAt: z.string() });
function rowValues<T extends z.ZodTypeAny>(value: T) {
  return rowAction.extend({ before: value, after: value });
}
function rowDrafts<T extends z.ZodTypeAny>(action: T) {
  return z.record(z.string().min(1), z.object({ generation: id, reviewed: z.literal(true).optional(), action }));
}
const titleAction = rowValues(z.string());
const nullableTitleAction = rowValues(z.string().nullable());
const durationAction = rowValues(z.number().finite().nonnegative().nullable());
const lockAction = rowValues(z.boolean());
const thoughtPlacementAction = rowValues(z.custom<ThoughtLocation>(isThoughtLocation));
const optionalCouncilField = z.discriminatedUnion('exists', [z.object({ exists: z.literal(false) }),
  z.object({ exists: z.literal(true), value: z.string() })]);
const councilDateAction = fieldAction.extend({ before: optionalCouncilField, after: optionalCouncilField });
const councilDateDraft = z.object({ generation: id, action: councilDateAction });
const councilOutcomeAction = rowValues(z.object({ discussed: z.boolean(), acceptedOptionId: z.string().nullable(), decision: z.string().nullable(),
  resolution: z.enum(['postponed', 'dropped']).nullable() }));
const exegeticalPointDraft = fieldAction.omit({ predecessorOperationId: true }).extend({
  nodeId: z.string().min(1).max(128), kind: z.enum(['title', 'remove']), generation: id,
  title: z.string().nullable(), ancestors: z.array(z.string().min(1)),
});
const serviceOrderAnchor = z.object({ id, generation: id.nullable() }).nullable();
const serviceOrderGap = z.object({ previous: serviceOrderAnchor, next: serviceOrderAnchor });
const serviceOrderPlacement = z.object({
  generation: id.nullable(), before: fieldSchema, rank: z.number().finite(), afterRequests: z.array(id).optional(),
  placement: fieldAction.extend({ opening: serviceOrderGap, destination: serviceOrderGap }),
});
const serviceOrderStepPlacement = z.object({
  generation: id.nullable(), shownIds: z.array(id),
  placement: fieldAction.extend({ stepId: id, opening: groupPlacementGap, destination: groupPlacementGap }),
});
const accountPreferenceField = z.custom<AccountPreferenceField>(field => ACCOUNT_PREFERENCE_TARGETS.some(target => target.field === field));
const checkpointConflict = z.object({
  path: z.array(z.string()), base: fieldSchema, mine: fieldSchema, theirs: fieldSchema, code: z.string().optional(),
  outlineSubpointIds: z.array(id).max(32).optional(),
  orderedOutlineSubpoints: z.array(z.object({ id, side: z.enum(['local', 'remote']) })).max(32).optional(),
  studyNoteReferenceOpening: fieldSchema.optional(),
});
const pendingCheckpoint = z.object({
  commentPlaceAction: commentPlaceObservation.optional(), outlinePointPlacement: outlinePlacement.optional(),
  groupFlowStepPlacement: groupPlacementCapture.optional(), councilTopicPlacement: councilPlacementCapture.optional(),
  generation: observedRevision, value: z.unknown(), operations: z.array(id).optional(),
  borrowedManualScope: z.string().refine(value => readManualScopeIdentity(value) !== null).optional(),
  groupTitleAction: textAction.optional(), groupStatusAction: textAction.optional(),
  councilTitleAction: textAction.optional(), councilDateAction: councilDateAction.optional(), councilLifecycleAction: councilDateAction.optional(),
  councilOutcomeActions: z.array(councilOutcomeAction).optional(), councilTopicTitleActions: z.array(titleAction).optional(),
  groupBlockTitleActions: z.array(titleAction).optional(), groupStepTitleActions: z.array(nullableTitleAction).optional(),
  groupBlockStatusActions: z.array(titleAction).optional(), groupStepDurationActions: z.array(durationAction).optional(),
  thoughtLockActions: z.array(lockAction).optional(), thoughtPlacementActions: z.array(thoughtPlacementAction).optional(),
  outlineTitleActions: z.array(titleAction).optional(),
} satisfies Record<keyof SessionCheckpoint['pending'][string], z.ZodTypeAny>);
const sourceNoteSelection = z.discriminatedUnion('exists', [z.object({ exists: z.literal(false) }),
  z.object({ exists: z.literal(true), value: z.array(id) })]);
const sourceNoteLinkCapture = z.object({
  opening: z.object({ sermonId: id, generation: id.nullable(), revision: observedRevision, selected: sourceNoteSelection, pending: z.array(id) }),
  action: z.object({ observedRevision, time: actionTime, reviewed: z.literal(true).optional(),
    changes: z.array(z.object({ noteId: id, linked: z.boolean(), queueId: id.optional(), predecessorOperationId: id.optional(),
      prior: z.object({ before: z.boolean(), observedRevision: observedRevision.nullable(), time: actionTime }).optional() })).min(1) }),
});
const sermonNoteOpening = z.object({
  sermonId: id, generation: id.nullable(), legacyBirth: z.string().min(1).optional(), pending: z.array(id), text: z.string().nullable(),
  target: z.union([
    z.object({ kind: z.literal('scratch'), id, createdAt: z.string().min(1) }),
    z.object({ kind: z.enum(['point', 'subpoint']), id }),
  ]),
});
const recordSchema = z.object({
  owner: id, editorId: z.string().min(1), prepared: z.unknown().nullable(), unfinalized: z.array(id).default([]),
  completedCommits: z.array(id).optional(),
  recoveryVersion: z.string().min(1).optional(),
  retainedManualChoice: z.object({ base: z.unknown(), decidingEditorId: z.string().min(1).optional(),
    groupStepPlacement: groupPlacementCapture.optional(), groupFieldsGeneration: id.nullable().optional(),
    councilTopicPlacement: councilPlacementCapture.optional(), councilFieldsGeneration: id.nullable().optional(),
    outlinePointPlacement: outlinePlacement.optional(), templateFieldsGeneration: id.nullable().optional(),
    sourceNoteLinks: sourceNoteLinkCapture.optional(), sermonNoteText: sermonNoteOpening.optional(), commentText: z.literal(true).optional() }).optional(),
  recoveryOrigins: z.array(z.object({ id: z.string().min(1), version: z.string().min(1) })).optional(),
  recoverySources: z.array(z.object({ id: z.string().min(1) })).optional(),
  checkpoint: z.object({
    confirmed: snapshotSchema, draft: z.unknown(), dirty: z.boolean(), editGeneration: z.number().int().safe().nonnegative(),
    remoteCandidate: snapshotSchema.nullable(),
    conflicts: z.array(checkpointConflict).default([]),
    exegeticalPointDrafts: z.array(exegeticalPointDraft).max(32).optional(),
    serviceOrderPlacementComparison: serviceOrderPlacementComparisonSchema.optional(),
    serviceOrderPlacementRetry: serviceOrderPlacement.optional(),
    serviceOrderStepPlacementRetry: serviceOrderStepPlacement.optional(),
    accountPreferenceRetry: z.object({ field: accountPreferenceField, time: actionTime }).optional(),
    groupTextReview: z.object({ requestId: id, revision: z.number().int().safe().nonnegative(), decisions: z.array(z.object({
      path: z.array(z.string()), birth: z.string().nullable(), mine: z.union([z.string(), z.number(), z.null()]), stored: z.union([z.string(), z.number(), z.null()]),
      side: z.enum(['local', 'remote']), row: z.record(z.string(), z.unknown()).optional(), removedBy: z.enum(['local', 'remote']).optional(),
      linkedSteps: z.array(z.record(z.string(), z.unknown())).optional(),
    })), separateDraft: z.literal(true).optional() }).optional(),
    sourceNoteLinkRetry: sourceNoteLinkCapture.optional(),
    outlinePointPlacementRetry: outlinePlacement.optional(),
    groupFlowStepPlacementRetry: groupPlacementCapture.optional(),
    councilTopicPlacementRetry: councilPlacementCapture.optional(),
    councilTitleDraft: groupFieldDraft.optional(), councilDateDraft: councilDateDraft.optional(),
    councilLifecycleDraft: councilDateDraft.optional(), councilTopicTitleDrafts: rowDrafts(titleAction).optional(),
    councilOutcomeDrafts: rowDrafts(councilOutcomeAction).optional(),
    groupTitleDraft: groupFieldDraft.optional(), groupStatusDraft: groupFieldDraft.optional(),
    groupBlockTitleDrafts: rowDrafts(titleAction).optional(), groupBlockStatusDrafts: rowDrafts(titleAction).optional(),
    groupStepTitleDrafts: rowDrafts(nullableTitleAction).optional(), groupStepDurationDrafts: rowDrafts(durationAction).optional(),
    thoughtLockDrafts: rowDrafts(lockAction).optional(), thoughtPlacementDrafts: rowDrafts(thoughtPlacementAction).optional(),
    outlineTitleDrafts: rowDrafts(titleAction).optional(),
    pending: z.record(id, pendingCheckpoint),
  } satisfies Record<keyof SessionCheckpoint, z.ZodTypeAny>),
});
const sameResource = (a: ResourceRef, b: ResourceRef) => a.collection === b.collection && a.id === b.id;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const recoveryCheckpointId = (owner: string, editorId: string): string => JSON.stringify([owner, editorId]);

/** Decode the same owner-scoped physical identity for discovery, forking and retirement. */
export function recoveryCheckpointEditorId(owner: string, sourceId: unknown): string | null {
  if (typeof sourceId !== 'string') return null;
  let identity: unknown;
  try { identity = JSON.parse(sourceId); } catch { return null; }
  return Array.isArray(identity) && identity.length === 2 && identity[0] === owner && typeof identity[1] === 'string'
    && sourceId === recoveryCheckpointId(owner, identity[1]) ? identity[1] : null;
}

function validateScopedEvidence(record: z.infer<typeof recordSchema>, collection: string): void {
  const pendingIntents = Object.values(record.checkpoint.pending);
  if (collection !== 'groups' && (record.retainedManualChoice?.groupStepPlacement
    || record.retainedManualChoice?.groupFieldsGeneration !== undefined || record.checkpoint.groupFlowStepPlacementRetry
    || record.checkpoint.groupTitleDraft || record.checkpoint.groupStatusDraft || record.checkpoint.groupBlockTitleDrafts
    || record.checkpoint.groupBlockStatusDrafts || record.checkpoint.groupStepTitleDrafts || record.checkpoint.groupStepDurationDrafts
    || pendingIntents.some(intent => intent.groupFlowStepPlacement || intent.groupTitleAction || intent.groupStatusAction
      || intent.groupBlockTitleActions || intent.groupBlockStatusActions || intent.groupStepTitleActions || intent.groupStepDurationActions))) throw new Error('Group placement checkpoint identity mismatch');
  if (collection !== 'councils' && (record.retainedManualChoice?.councilTopicPlacement
    || record.retainedManualChoice?.councilFieldsGeneration !== undefined || record.checkpoint.councilTopicPlacementRetry
    || record.checkpoint.councilTitleDraft || record.checkpoint.councilDateDraft || record.checkpoint.councilLifecycleDraft
    || record.checkpoint.councilTopicTitleDrafts || record.checkpoint.councilOutcomeDrafts
    || pendingIntents.some(intent => intent.councilTopicPlacement || intent.councilTitleAction || intent.councilDateAction
      || intent.councilLifecycleAction || intent.councilTopicTitleActions || intent.councilOutcomeActions))) throw new Error('Council placement checkpoint identity mismatch');
  if (collection !== 'planTemplates' && (record.retainedManualChoice?.outlinePointPlacement
    || record.retainedManualChoice?.templateFieldsGeneration !== undefined)) throw new Error('Template recovery checkpoint identity mismatch');
  if (!outlinePlacementField(collection) && (record.checkpoint.outlinePointPlacementRetry
    || record.checkpoint.outlineTitleDrafts || pendingIntents.some(intent => intent.outlinePointPlacement || intent.outlineTitleActions))) {
    throw new Error('Outline checkpoint identity mismatch');
  }
  if (collection !== 'sermons' && (record.checkpoint.exegeticalPointDrafts || record.checkpoint.thoughtLockDrafts
    || record.checkpoint.thoughtPlacementDrafts || pendingIntents.some(intent => intent.thoughtLockActions || intent.thoughtPlacementActions))) {
    throw new Error('Sermon checkpoint identity mismatch');
  }
  if (collection !== 'serviceOrders' && (record.checkpoint.serviceOrderPlacementRetry || record.checkpoint.serviceOrderStepPlacementRetry)) {
    throw new Error('Service order checkpoint identity mismatch');
  }
  if (!['serviceOrders', 'groups', 'councils'].includes(collection) && record.checkpoint.serviceOrderPlacementComparison) {
    throw new Error('Placement comparison checkpoint identity mismatch');
  }
  if (collection !== 'users' && record.checkpoint.accountPreferenceRetry) throw new Error('Preference checkpoint identity mismatch');
}

/** Validate recovered disk data before it can enter a controller or another account. */
export function validateRecoveryRecord(value: unknown, owner: string, editorId: string, resource?: ResourceRef): EditorRecord {
  const record = recordSchema.parse(value);
  const ref = record.checkpoint.confirmed.resource;
  if (record.owner !== owner || record.editorId !== editorId || (resource && !sameResource(resource, ref))
    || (record.checkpoint.remoteCandidate && !sameResource(ref, record.checkpoint.remoteCandidate.resource))) throw new Error('Checkpoint identity mismatch');
  if (record.retainedManualChoice?.commentText && ref.collection !== 'studyNotes') throw new Error('Comment text checkpoint identity mismatch');
  const note = record.retainedManualChoice?.sermonNoteText;
  if (note && (ref.collection !== 'sermons' || note.sermonId !== ref.id)) throw new Error('Sermon note checkpoint identity mismatch');
  const sourceLinks = [record.checkpoint.sourceNoteLinkRetry, record.retainedManualChoice?.sourceNoteLinks];
  if (sourceLinks.some(links => links && (ref.collection !== 'sermons' || links.opening.sermonId !== ref.id
    || links.action.observedRevision !== links.opening.revision))) throw new Error('Source note checkpoint identity mismatch');
  const groupTextReview = record.checkpoint.groupTextReview;
  if (groupTextReview && (ref.collection !== 'groups' || !record.checkpoint.pending[groupTextReview.requestId])) {
    throw new Error('Group text review checkpoint identity mismatch');
  }
  validateScopedEvidence(record, ref.collection);
  const document = (data: unknown) => snapshotSchema.parse({ resource: ref, value: data, metadata: null }).value;
  const policy = getResourcePolicy(ref.collection);
  const ownedDocument = (data: unknown, createIntent = false) => {
    const value = document(data);
    if (policy.ownerField === 'id' ? ref.id !== owner : value !== null && value[policy.ownerField] !== owner
      && !(createIntent && !Object.prototype.hasOwnProperty.call(value, policy.ownerField))) throw new Error('Checkpoint document ownership mismatch');
    return value;
  };
  ownedDocument(record.checkpoint.confirmed.value);
  if (record.checkpoint.remoteCandidate) ownedDocument(record.checkpoint.remoteCandidate.value);
  const field = (input: z.infer<typeof fieldSchema>): FieldValue => input.exists
    ? { exists: true, value: document({ value: input.value })!.value } : { exists: false };
  const prepared = record.prepared === null ? null : validateCommand(record.prepared);
  if (prepared && (prepared.owner !== owner || !sameResource(prepared.resource, ref)
    || !Object.prototype.hasOwnProperty.call(record.checkpoint.pending, prepared.operationId))) throw new Error('Prepared checkpoint identity mismatch');
  const conflicts: ConflictDetail[] = record.checkpoint.conflicts.map(({ studyNoteReferenceOpening, ...conflict }) => ({
    ...conflict, base: field(conflict.base), mine: field(conflict.mine), theirs: field(conflict.theirs),
    ...(studyNoteReferenceOpening && { studyNoteReferenceOpening: field(studyNoteReferenceOpening) }),
  }));
  const placement = record.checkpoint.serviceOrderPlacementRetry;
  const createIntent = record.checkpoint.confirmed.value === null && record.checkpoint.confirmed.metadata === null;
  const pending = Object.fromEntries(Object.entries(record.checkpoint.pending).map(([operationId, intent]) => {
    const { commentPlaceAction: place, ...held } = intent;
    if (place && ref.collection !== 'studyNotes') throw new Error('Comment place checkpoint identity mismatch');
    return [operationId, { ...held, value: ownedDocument(intent.value, createIntent),
      ...(place && { commentPlaceAction: { ...place, before: field(place.before), after: field(place.after), paragraph: field(place.paragraph) } }) }];
  }));
  const retainedManualChoice = record.retainedManualChoice && {
    ...record.retainedManualChoice, base: ownedDocument(record.retainedManualChoice.base),
  };
  const groupReview = groupTextReview && { ...groupTextReview, decisions: groupTextReview.decisions.map(decision => ({
    ...decision, row: decision.row ? document(decision.row)! : undefined,
    linkedSteps: decision.linkedSteps?.map(step => document(step)!),
  })) };
  return clone({ ...record, retainedManualChoice, prepared,
    checkpoint: { ...record.checkpoint, draft: ownedDocument(record.checkpoint.draft, createIntent),
      pending, conflicts, groupTextReview: groupReview,
      serviceOrderPlacementRetry: placement && { ...placement, before: field(placement.before) } } });
}

export function isRecoverableCheckpoint(record: EditorRecord): boolean {
  return record.checkpoint.dirty || record.prepared !== null || Object.keys(record.checkpoint.pending).length > 0 || record.unfinalized.length > 0;
}

/** A submitted projection is distinct from a checkpoint that also contains private work. */
export function isOnlySubmittedCopy(record: EditorRecord, includes: (requestId: string) => boolean): boolean {
  const { checkpoint, prepared, unfinalized } = record;
  const pending = Object.entries(checkpoint.pending);
  return !prepared && !unfinalized.length && pending.every(([id]) => includes(id))
    && pending.some(([, intent]) => intent.generation === checkpoint.editGeneration && equalValues(intent.value, checkpoint.draft));
}

/** A submitted creation already followed by Delete contributes no independent draft to reopen. */
export function isOnlyRemovedCreationCopy(record: EditorRecord, creations: ReadonlySet<string>): boolean {
  const { checkpoint } = record;
  return checkpoint.confirmed.value === null && !checkpoint.conflicts.length && !checkpoint.remoteCandidate
    && !record.retainedManualChoice && isOnlySubmittedCopy(record, id => creations.has(id));
}

/** A saved projection still pins its receipts, but offers no competing recovery copy. */
export function isPassiveManualContinuation(record: EditorRecord): boolean {
  return isOnlySubmittedCopy(record, id => Boolean(record.checkpoint.pending[id].borrowedManualScope));
}

/**
 * Background delivery outlives the editor that saved. Project its durable results
 * before offering recovery, using exactly the mounted editor's ACK/rebase rule.
 * This is a read-only view: another live tab may still own the stored checkpoint.
 * Requests must be in dependency order, as returned by CommitQueue.list().
 */
export function reconcileRecoveryRecord(record: EditorRecord, requests: readonly CommitRequest[]): EditorRecord {
  const session = DataSession.restore(record.checkpoint);
  const completed = new Set(record.completedCommits ?? []);
  for (const request of orderActionProjections(requests)) {
    if (request.owner !== record.owner || !sameResource(request.baseline.resource, record.checkpoint.confirmed.resource)
      || completed.has(request.id)
      || (request.editorId !== record.editorId && !session.checkpoint().pending[request.id])) continue;
    // Work the person decided on another editor settles here too (`DataSession.applyCommit`).
    if (session.applyCommit(request)) completed.add(request.id);
  }
  return { ...clone(record), checkpoint: session.checkpoint(), ...(completed.size ? { completedCommits: [...completed] } : {}) };
}

/** Owner filtering happens before reading another owner's record contents. */
export function selectRecoverableCheckpoints(records: readonly (readonly [unknown, unknown])[], owner: string, resource?: ResourceRef): RecoveryCheckpoint[] {
  const selected: RecoveryCheckpoint[] = [];
  for (const [key, value] of records) {
    const editorId = recoveryCheckpointEditorId(owner, key);
    if (editorId === null || typeof key !== 'string') continue;
    const record = validateRecoveryRecord(value, owner, editorId);
    if ((!resource || sameResource(resource, record.checkpoint.confirmed.resource)) && isRecoverableCheckpoint(record)) {
      selected.push({ id: key, record });
    }
  }
  return selected;
}

function checkpointForkRecord(original: EditorRecord, sourceId: string, editorId: string, version: string | null): EditorRecord {
  return clone({ ...original, editorId, recoveryVersion: undefined, retainedManualChoice: undefined,
    recoverySources: recoverySources(original.recoverySources, sourceId),
    recoveryOrigins: version ? recoveryOrigins(original.recoveryOrigins, { id: sourceId, version }) : undefined });
}

/** Explicit fork preserves pending operation identity and never takes over the source editor. */
export async function forkCheckpoint(store: Pick<CheckpointRecoveryStore, 'read' | 'create' | 'pinRecovery'>, owner: string, sourceId: string, newEditorId: string, resource: ResourceRef): Promise<EditorRecord> {
  const sourceEditorId = recoveryCheckpointEditorId(owner, sourceId);
  if (sourceEditorId === null || !newEditorId || newEditorId === sourceEditorId) throw new Error('Invalid checkpoint recovery identity');
  for (let attempt = 0; ; attempt += 1) {
    const value = await store.read(owner, sourceEditorId);
    if (!value) throw Object.assign(new Error('Recovery checkpoint no longer exists'), { code: 'draft-gone' });
    const original = validateRecoveryRecord(value, owner, sourceEditorId, resource);
    if (!isRecoverableCheckpoint(original)) throw Object.assign(new Error('The checkpoint has no pending local work'), { code: 'draft-done' });
    const version = store.pinRecovery ? await store.pinRecovery(original) : null;
    if (store.pinRecovery && !version) {
      if (attempt < 2) continue;
      throw Object.assign(new Error('Recovery source changed before capture'), { code: 'decision-changed' });
    }
    const forked = checkpointForkRecord(original, sourceId, newEditorId, version);
    try { await store.create(forked); return clone(forked); }
    catch (error) {
      if ((error as { code?: string }).code !== 'commit-reference-changed' || attempt === 2) throw error;
    }
  }
}
