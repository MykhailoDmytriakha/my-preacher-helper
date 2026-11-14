'use client';

import { z } from 'zod';

import { SECTION_KEYS } from '@/utils/outlineDnd';

import { ACCOUNT_PREFERENCE_TARGETS } from './accountPreference';
import { boundedActionTime } from './actionClock';
import { orderActionProjections } from './atomicCommits';
import { readManualScopeIdentity } from './editorIdentity';
import { equalValues, getResourcePolicy, isValidIdentifier, validateCommand } from './protocol';
import { recoverySources } from './recoveryPresence';
import { recoveryOrigins } from './recoverySource';
import { boundedRowId } from './rowFieldAction';
import { DataSession } from './session';
import { json, serviceOrderPlacementComparison, snapshotSchema } from './transport.client';

import type { AccountPreferenceField } from './accountPreference';
import type { CommitRequest } from './commits';
import type { CheckpointRecoveryStore, EditorRecord, RecoveryCheckpoint } from './controller';
import type { AutosaveFieldDraft, DocumentFieldObservation, DocumentFieldStamp } from './documentFieldAction';
import type { RowDetailObservation } from './rowDetailAction';
import type { RowValue } from './rowFieldAction';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, FieldValue, OutlinePointPlacement, OutlinePointPlacementCapture, ResourceRef, ServiceOrderStepGap } from './types';
import type { OutlinePointGap, OutlinePointOrder, SectionKey } from '@/utils/outlineDnd';

/*
 * THE CHECKPOINT CODEC. Every object shape below lists exactly the keys of its TypeScript type
 * (`satisfies Record<keyof …>`), nested shapes included, so a key added to a type cannot be stripped
 * on disk unnoticed. Value types are not compared by the compiler: some TypeScript types are looser
 * than the stored meaning (`FieldValue`, an autosave draft's independent before/after). A runtime value
 * this codec does not accept trips the dropped-proof tripwire, which fails the test under Jest
 * (jest.setup.js).
 */
type Keys<T> = Record<keyof T, z.ZodTypeAny>;
type CheckpointKey<Key extends keyof SessionCheckpoint> = Key;
type Pending = SessionCheckpoint['pending'][string];
const id = z.string().refine(isValidIdentifier);
const fieldSchema = z.discriminatedUnion('exists', [z.object({ exists: z.literal(false) }), z.object({ exists: z.literal(true), value: json })]);
const revision = z.number().int().safe().nonnegative();
const time = z.object({ earliestMs: z.number().int().safe().positive(), latestMs: z.number().int().safe().positive() })
  .refine(value => boundedActionTime(value) !== undefined).nullable();
const stampShape = { observedRevision: revision, time, predecessorOperationId: id.optional() } satisfies Keys<DocumentFieldStamp>;
const textObservationShape = { ...stampShape, before: z.string(), after: z.string() } satisfies Keys<DocumentFieldObservation>;
const textObservation = z.object(textObservationShape);
const fieldObservation = z.object({ ...stampShape, before: fieldSchema, after: fieldSchema } satisfies Keys<DocumentFieldObservation<FieldValue>>);
const fieldDraft = z.object({ generation: id, action: z.union([textObservation, fieldObservation]) } satisfies Keys<AutosaveFieldDraft>);
const rowValue = z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.record(json)]);
const rowObservation = z.object({ ...stampShape, rowId: z.custom<string>(boundedRowId), rowCreatedAt: z.string(), before: rowValue, after: rowValue,
} satisfies Keys<RowDetailObservation<RowValue>>);
const rowDraft = z.object({ generation: id, action: rowObservation } satisfies Keys<NonNullable<SessionCheckpoint['thoughtLockDrafts']>[string]>);
const rowDrafts = z.record(rowDraft);
const stepGapShape = { previous: id.nullable(), next: id.nullable() } satisfies Keys<ServiceOrderStepGap>;
const section = z.custom<SectionKey>(value => SECTION_KEYS.includes(value as SectionKey));
const pointGap = z.object({ ...stepGapShape, section } satisfies Keys<OutlinePointGap>);
const points = z.array(z.object({ id }));
const pointOrder = z.object({ introduction: points, main: points, conclusion: points } satisfies Keys<OutlinePointOrder>);
const outlinePlacement = z.object({ generation: id.nullable(), before: pointOrder, after: pointOrder,
  placement: z.object({ ...stampShape, pointId: id, opening: pointGap, destination: pointGap } satisfies Keys<OutlinePointPlacement>),
} satisfies Keys<OutlinePointPlacementCapture>);
const exegeticalDraft = z.object({ ...stampShape, nodeId: z.string().min(1).max(128), kind: z.enum(['title', 'remove']),
  generation: id, title: z.string().nullable(), ancestors: z.array(z.string()),
} satisfies Keys<NonNullable<SessionCheckpoint['exegeticalPointDrafts']>[number]>);
const accountPreferenceRetry = z.object({ time,
  field: z.custom<AccountPreferenceField>(value => ACCOUNT_PREFERENCE_TARGETS.some(target => target.field === value)),
} satisfies Keys<NonNullable<SessionCheckpoint['accountPreferenceRetry']>>);

/** Ordering proofs a Save in flight carries: never the Save's words, which stay core. */
const pendingEvidence = {
  // Group title and status are causal: an unclocked autosave carries `time: null` (documentFieldAction.ts:637).
  groupTitleAction: textObservation, groupStatusAction: textObservation,
  councilTitleAction: textObservation, councilDateAction: fieldObservation, councilLifecycleAction: fieldObservation,
  councilOutcomeActions: z.array(rowObservation), councilTopicTitleActions: z.array(rowObservation),
  groupBlockTitleActions: z.array(rowObservation), groupStepTitleActions: z.array(rowObservation),
  groupBlockStatusActions: z.array(rowObservation), groupStepDurationActions: z.array(rowObservation),
  thoughtLockActions: z.array(rowObservation), thoughtPlacementActions: z.array(rowObservation),
  outlinePointPlacement: outlinePlacement,
} satisfies Keys<Omit<Pending, 'generation' | 'value' | 'operations' | 'borrowedManualScope'>>;
/**
 * Deliberately not persisted, stripped on every device write as before: a placement retry is an instruction to resend
 * a move, and a recovered one would replay a move a later draft abandoned and mark unsent words as sent.
 */
type NotPersisted = CheckpointKey<'serviceOrderPlacementRetry' | 'serviceOrderStepPlacementRetry' | 'outlinePointPlacementRetry'>;
/** Ordering proofs, comparisons and the account retry beside the draft. */
const checkpointEvidence = {
  groupTitleDraft: fieldDraft, groupStatusDraft: fieldDraft, councilTitleDraft: fieldDraft,
  councilDateDraft: fieldDraft, councilLifecycleDraft: fieldDraft,
  councilOutcomeDrafts: rowDrafts, councilTopicTitleDrafts: rowDrafts, groupBlockTitleDrafts: rowDrafts, groupStepTitleDrafts: rowDrafts,
  groupBlockStatusDrafts: rowDrafts, groupStepDurationDrafts: rowDrafts, thoughtLockDrafts: rowDrafts, thoughtPlacementDrafts: rowDrafts,
  exegeticalPointDrafts: z.array(exegeticalDraft), serviceOrderPlacementComparison, accountPreferenceRetry,
} satisfies Keys<Omit<SessionCheckpoint, 'confirmed' | 'draft' | 'dirty' | 'editGeneration' | 'remoteCandidate' | 'conflicts' | 'pending' | NotPersisted>>;
const optional = <Shape extends Record<string, z.ZodTypeAny>>(shape: Shape) =>
  Object.fromEntries(Object.entries(shape).map(([key, schema]) => [key, schema.optional()])) as { [Key in keyof Shape]: z.ZodOptional<Shape[Key]> };
const pendingShape = {
  generation: revision, value: z.unknown(), operations: z.array(id).optional(),
  borrowedManualScope: z.string().refine(value => readManualScopeIdentity(value) !== null).optional(),
  ...optional(pendingEvidence),
} satisfies Keys<Pending>;
const checkpointShape = {
  confirmed: snapshotSchema, draft: z.unknown(), dirty: z.boolean(), editGeneration: revision,
  remoteCandidate: snapshotSchema.nullable(),
  conflicts: z.array(z.object({ path: z.array(z.string()), base: fieldSchema, mine: fieldSchema, theirs: fieldSchema })).default([]),
  pending: z.record(id, z.object(pendingShape)),
  ...optional(checkpointEvidence),
} satisfies Keys<Omit<SessionCheckpoint, NotPersisted>>;
const recordSchema = z.object({
  owner: id, editorId: z.string().min(1), prepared: z.unknown().nullable(), unfinalized: z.array(id).default([]),
  completedCommits: z.array(id).optional(),
  recoveryVersion: z.string().min(1).optional(),
  retainedManualChoice: z.object({ base: z.unknown(), decidingEditorId: z.string().min(1).optional() }).optional(),
  recoveryOrigins: z.array(z.object({ id: z.string().min(1), version: z.string().min(1) })).optional(),
  recoverySources: z.array(z.object({ id: z.string().min(1) })).optional(),
  checkpoint: z.object(checkpointShape),
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

/**
 * WHO HEARS ABOUT A DROPPED PROOF. A proof field this version cannot validate is dropped whole — exactly as
 * every proof field was dropped before this codec knew them — and its name is reported: by default once per
 * name per page session on the console, names only, never values or the person's text. A reporter or console
 * that throws is ignored here, so a diagnostic never decides whether a draft is readable. The reporter lives in a
 * global slot so the Jest setup can collect names without loading this module first.
 */
export type DroppedEvidenceReporter = (fields: readonly string[]) => void;
const DROPPED_EVIDENCE_REPORTER = Symbol.for('preacher.dataEngine.droppedEvidenceReporter');
const reportedFields = new Set<string>();
const sayDroppedEvidence: DroppedEvidenceReporter = fields => {
  const unsaid = fields.filter(field => !reportedFields.has(field));
  if (!unsaid.length) return;
  unsaid.forEach(field => reportedFields.add(field));
  console.error('Data engine dropped unreadable checkpoint evidence:', unsaid.join(', '));
};
function reportDroppedEvidence(fields: readonly string[]): void {
  try {
    const installed = (globalThis as unknown as Record<symbol, DroppedEvidenceReporter | undefined>)[DROPPED_EVIDENCE_REPORTER];
    (installed ?? sayDroppedEvidence)(fields);
  } catch { /* A diagnostic that fails says nothing. */ }
}

type Fields = Record<string, unknown>;
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
/**
 * Every proof a producer writes nests at most four levels (a row map, its row, the action, a flat before/after).
 * A proof deeper than the bound is unreadable and is dropped before any recursive parse — this one or the record's
 * own second parse — can come near the stack limit; a parser that throws drops it too.
 */
const MAX_PROOF_DEPTH = 32;
function nestsDeeperThan(value: unknown, limit: number): boolean {
  const open: Array<[unknown, number]> = [[value, 1]];
  for (let next = open.pop(); next; next = open.pop()) {
    const [node, depth] = next;
    if (typeof node !== 'object' || node === null) continue;
    if (depth > limit) return true;
    for (const child of Object.values(node)) open.push([child, depth + 1]);
  }
  return false;
}
function accepts(schema: z.ZodTypeAny, value: unknown): boolean {
  if (nestsDeeperThan(value, MAX_PROOF_DEPTH)) return false;
  try { return schema.safeParse(value).success; } catch { return false; }
}
/** A proof field passes whole or goes whole; the words and core fields beside it are the validator's. */
function withoutInvalidProof(fields: Fields, schemas: Record<string, z.ZodTypeAny>, prefix: string, dropped: string[]): Fields {
  let kept = fields;
  for (const [key, schema] of Object.entries(schemas)) {
    if (fields[key] === undefined || accepts(schema, fields[key])) continue;
    if (kept === fields) kept = { ...fields };
    delete kept[key];
    dropped.push(prefix + key);
  }
  return kept;
}

/** Validate recovered disk data before it can enter a controller or another account. */
export function validateRecoveryRecord(value: unknown, owner: string, editorId: string, resource?: ResourceRef): EditorRecord {
  const dropped: string[] = [];
  let checked = value;
  if (isFields(value) && isFields(value.checkpoint)) {
    let checkpoint = withoutInvalidProof(value.checkpoint, checkpointEvidence, '', dropped);
    if (isFields(checkpoint.pending)) {
      const pending = checkpoint.pending;
      const kept = Object.fromEntries(Object.entries(pending).map(([operationId, intent]) =>
        [operationId, isFields(intent) ? withoutInvalidProof(intent, pendingEvidence, 'pending.', dropped) : intent]));
      if (Object.keys(kept).some(operationId => kept[operationId] !== pending[operationId])) checkpoint = { ...checkpoint, pending: kept };
    }
    if (checkpoint !== value.checkpoint) checked = { ...value, checkpoint };
  }
  if (dropped.length) reportDroppedEvidence([...new Set(dropped)]);
  return decodeRecoveryRecord(checked, owner, editorId, resource);
}

/** Core fields, identity and ownership stay strict, as before. */
function decodeRecoveryRecord(value: unknown, owner: string, editorId: string, resource?: ResourceRef): EditorRecord {
  const record = recordSchema.parse(value);
  const ref = record.checkpoint.confirmed.resource;
  if (record.owner !== owner || record.editorId !== editorId || (resource && !sameResource(resource, ref))
    || (record.checkpoint.remoteCandidate && !sameResource(ref, record.checkpoint.remoteCandidate.resource))) throw new Error('Checkpoint identity mismatch');
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
  const conflicts: ConflictDetail[] = record.checkpoint.conflicts.map(conflict => ({ ...conflict, base: field(conflict.base), mine: field(conflict.mine), theirs: field(conflict.theirs) }));
  const createIntent = record.checkpoint.confirmed.value === null && record.checkpoint.confirmed.metadata === null;
  // A causal group action may be unclocked (`time: null`, documentFieldAction.ts:637,678) although
  // `GroupFieldActions` declares a clocked `DocumentFieldAction`; the stored copy keeps what the producer wrote.
  const pending = Object.fromEntries(Object.entries(record.checkpoint.pending).map(([operationId, intent]) =>
    [operationId, { ...intent, value: ownedDocument(intent.value, createIntent) }])) as SessionCheckpoint['pending'];
  const retainedManualChoice = record.retainedManualChoice && {
    ...record.retainedManualChoice, base: ownedDocument(record.retainedManualChoice.base),
  };
  return clone({ ...record, retainedManualChoice, prepared,
    checkpoint: { ...record.checkpoint, draft: ownedDocument(record.checkpoint.draft, createIntent), pending, conflicts } });
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
