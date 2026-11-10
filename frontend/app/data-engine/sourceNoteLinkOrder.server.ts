import { createHash } from 'node:crypto';

import { boundedActionTime } from './actionClock';
import { changeTagMembership, tagMembership } from './documentTagMembership';
import { object, readField } from './fieldValues';
import { isValidIdentifier } from './protocol';
import { proofRevision, rowConflictValue } from './rowFieldAction';
import { SOURCE_NOTE_FIELD, sourceNoteLinkChange, sourceNoteLinks, sourceNoteList } from './sourceNoteLinkAction';
import { decideTagMembership } from './tagMembershipOrder';
import { readTagProofIdentity, tagProofIdentity, tagProofKey } from './tagProofIdentity.server';
import { readTagProofStorage, retainTagProofStorage } from './tagProofStorage.server';

import type { ActionTime } from './actionClock';
import type { SourceNoteChoice, SourceNoteLinkAction } from './sourceNoteLinkAction';
import type { TagMembershipProof } from './tagMembershipOrder';
import type { TagProofIdentity } from './tagProofIdentity.server';
import type { SourceNoteProofMark } from './tagProofStorage.server';
import type { ConflictDetail, DataCommand, FieldValue, ResourceSnapshot } from './types';

export const SOURCE_NOTE_LINK_HISTORY = '_sourceNoteLinkHistory';

type Proof = TagMembershipProof & TagProofIdentity & SourceNoteProofMark;
type Stamp = { noteId: string; linked: boolean; time: ActionTime | null; causal: boolean } & SourceNoteProofMark;
export type SourceNoteLinkHistoryEntry = { noteId: string; linked: boolean; keptLinked: boolean; actionTime: ActionTime; keptActionTime: ActionTime };
type SourceNoteOrder = { command: DataCommand; uncertain: ConflictDetail[]; stamps: Stamp[]; displaced: SourceNoteLinkHistoryEntry[] };

const queueDigest = (id?: string) => id ? createHash('sha256').update(id).digest('base64url') : undefined;

function readProofs(raw: unknown, generation: string | null) {
  const stored = generation && object(raw) && raw.generation === generation ? raw.sourceNoteLinkProofs : undefined;
  const { floor, entries } = readTagProofStorage(stored);
  const proofs = new Map<string, Proof>();
  for (const entry of entries) {
    if (!object(entry) || typeof entry.present !== 'boolean' || !proofRevision(entry.revision) || !isValidIdentifier(entry.operationId)) continue;
    const identity = readTagProofIdentity(entry, isValidIdentifier);
    const time = entry.time === null ? null : boundedActionTime(entry.time);
    if (identity && time !== undefined) proofs.set(tagProofKey(identity), { ...identity, present: entry.present,
      revision: entry.revision, operationId: entry.operationId, time, causal: entry.causal === true,
      ...(entry.tracked === true && { tracked: true }),
      ...(typeof entry.queueDigest === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(entry.queueDigest) && { queueDigest: entry.queueDigest }) });
  }
  return { floor, proofs };
}

function presentIds(field: FieldValue) {
  const notes = sourceNoteList(field, isValidIdentifier);
  return notes && new Set(notes);
}

export function orderSourceNoteLinks(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number): SourceNoteOrder {
  const result: SourceNoteOrder = { command, uncertain: [], stamps: [], displaced: [] };
  const metadata = current.metadata;
  if (command.kind !== 'update' || command.resource.collection !== 'sermons' || !current.value
    || metadata?.deleted || command.generation !== (metadata?.generation ?? null)) return result;
  const change = sourceNoteLinkChange(command.changes);
  if (!change) return result;
  const savedField = sourceNoteLinks(current.value);
  const opening = presentIds(change.before), requested = presentIds(change.after), saved = presentIds(savedField);
  if (!opening || !requested || !saved) return result;
  const revision = metadata?.revision ?? 0;
  const { floor, proofs } = readProofs(raw, command.generation);
  const action = command.sourceNoteLinkAction;
  const choices: SourceNoteLinkAction['changes'] = action?.changes ?? [...new Set([...opening, ...requested])]
    .filter(noteId => opening.has(noteId) !== requested.has(noteId)).map(noteId => ({ noteId, linked: requested.has(noteId) }));
  // An optional legacy array is logically empty during independent additions.
  let before: FieldValue = change.before.exists || !savedField.exists ? change.before : { exists: true, value: [] };
  let after: FieldValue = change.after.exists || !savedField.exists ? change.after : { exists: true, value: [] };
  for (const choice of choices) {
    const { noteId, linked } = choice;
    const wasLinked = opening.has(noteId), isLinked = saved.has(noteId);
    const proof = proofs.get(tagProofKey(noteId));
    const requireChoice = () => result.uncertain.push({ path: [SOURCE_NOTE_FIELD, 'string:' + noteId],
      base: rowConflictValue(wasLinked), mine: rowConflictValue(linked), theirs: rowConflictValue(isLinked) });
    const { decision, digest } = sourceNoteDecision(choice, action, wasLinked, isLinked, proof, revision, floor, serverMs);
    if (decision.kind === 'uncertain') requireChoice();
    if (decision.kind === 'stamp') result.stamps.push({ noteId, linked, time: decision.time, causal: decision.causal,
      tracked: true, ...(decision.causal && digest && { queueDigest: digest }) });
    if (decision.kind === 'ordered') {
      before = changeTagMembership(before, noteId, isLinked);
      if (!decision.incomingWins) after = changeTagMembership(after, noteId, isLinked);
      else result.stamps.push({ noteId, linked, time: decision.incomingTime, causal: true, tracked: true, ...(digest && { queueDigest: digest }) });
      result.displaced.push({ noteId, linked: decision.incomingWins ? isLinked : linked, keptLinked: decision.incomingWins ? linked : isLinked,
        actionTime: decision.incomingWins ? decision.storedTime : decision.incomingTime,
        keptActionTime: decision.incomingWins ? decision.incomingTime : decision.storedTime });
    }
  }
  if (!savedField.exists && !presentIds(before)?.size && !presentIds(after)?.size) {
    before = savedField;
    after = savedField;
  }
  if (before !== change.before || after !== change.after) {
    const { sourceNoteLinkAction: _action, ...adjusted } = command;
    result.command = { ...adjusted, changes: command.changes.map(item => item === change ? { ...change, before, after } : item) };
  }
  return result;
}

function sourceNoteDecision(choice: SourceNoteChoice, action: SourceNoteLinkAction | undefined, before: boolean, stored: boolean,
  proof: Proof | undefined, revision: number, floor: number, serverMs: number): {
    decision: ReturnType<typeof decideTagMembership>; digest?: string;
  } {
  const { noteId, linked, queueId, predecessorOperationId, prior } = choice;
  const observed = prior ? prior.observedRevision : action?.observedRevision;
  const check = (uncertain: boolean) => ({ decision: { kind: uncertain && linked !== stored ? 'uncertain' : 'keep' } } as const);
  if (observed === undefined || observed === null) return check(Boolean(proof?.tracked || proof?.causal || floor));
  if (observed > revision || (!prior && action?.reviewed && (before !== stored || Math.max(proof?.revision ?? 0, floor) > observed))) {
    return check(true);
  }
  const captured = prior ? prior.time : action?.time;
  const time = captured && Number.isFinite(serverMs) && captured.earliestMs <= serverMs + 5 ? captured : null;
  const digest = queueDigest(queueId);
  const predecessor = digest && proof?.queueDigest === digest ? predecessorOperationId : undefined;
  return { digest, decision: decideTagMembership({ tag: noteId, before, after: linked, time,
    observedRevision: observed, predecessorOperationId: predecessor }, stored, proof, revision, floor) };
}

export function metadataAfterSourceNoteLinks(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined, order?: SourceNoteOrder) {
  const { metadata, value } = snapshot;
  if (snapshot.resource.collection !== 'sermons' || !metadata?.operationId || !value) return metadata;
  const before = presentIds(object(raw) ? readField(raw, [SOURCE_NOTE_FIELD]) : { exists: false }), after = presentIds(sourceNoteLinks(value));
  if (!before || !after) return metadata;
  const stored = readProofs(raw?._dataEngine, metadata.generation);
  const liveKeys = new Set([...after].map(tagProofKey));
  const recorded = new Map<string, Proof>();
  const add = ({ noteId, linked, ...stamp }: Stamp) => {
    const identity = tagProofIdentity(noteId);
    recorded.set(tagProofKey(identity), { ...stamp, ...identity, present: linked,
      revision: metadata.revision, operationId: metadata.operationId! });
  };
  for (const stamp of order?.stamps ?? []) if (after.has(stamp.noteId) === stamp.linked) add(stamp);
  for (const noteId of new Set([...before, ...after])) {
    if (!recorded.has(tagProofKey(noteId)) && before.has(noteId) !== after.has(noteId)) {
      const previous = stored.proofs.get(tagProofKey(noteId));
      add({ noteId, linked: after.has(noteId), time: null, causal: false,
        ...(Boolean(previous?.tracked || previous?.causal) && { tracked: true }) });
    }
  }
  for (const [key, proof] of stored.proofs) {
    if (!recorded.has(key) && liveKeys.has(key) === proof.present) recorded.set(key, proof);
  }
  const retained = retainTagProofStorage(recorded.values(), stored.floor, value, metadata);
  return retained ? { ...metadata, sourceNoteLinkProofs: retained } : metadata;
}

export function retainedSourceNoteLinkHistory(snapshot: ResourceSnapshot, order?: SourceNoteOrder) {
  return order?.displaced.filter(change => tagMembership(sourceNoteLinks(snapshot.value), change.noteId) === change.keptLinked) ?? [];
}
