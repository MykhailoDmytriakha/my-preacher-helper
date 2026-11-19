import { createHash } from 'node:crypto';

import { boundedActionTime, compareActionTime } from './actionClock';
import { conflictReceiptDigest, readConflictJsonParts, splitConflictJson, validConflictPartCount } from './conflictReceiptParts.server';
import { documentProofHeadroom } from './documentProofBudget.server';
import { commandFingerprint, equalValues, object, readField } from './fieldValues';
import { validateResourceDocument } from './resourceSchemas';
import { isOrdinaryReferenceDocument, referenceRows, studyNoteReferencesPath } from './studyNoteReferenceMerge';

import type { ActionTime } from './actionClock';
import type { ReferenceRow, StudyNoteReferenceOrder } from './studyNoteReferenceMerge';
import type { DataCommand, DocumentData, EngineMetadata, ResourceSnapshot } from './types';

export const STUDY_NOTE_REFERENCE_HISTORY = '_studyNoteReferenceHistory';

export type StudyNoteReferenceHistoryEntry = {
  rowId: string;
  value: ReferenceRow | null;
  winner: ReferenceRow | null;
  actionTime: ActionTime;
  winnerActionTime: ActionTime;
  origin?: 'comparison';
};

const PROOF_FIELD = 'studyNoteReferenceActionTimes';
const REMOVAL_FIELD = 'studyNoteReferenceRemovals';
const MAX_REMOVALS = 128;
const rowDigest = (row: DocumentData): string => createHash('sha256').update(commandFingerprint(row)).digest('base64url');
type ReferenceProof = { time: ActionTime | null; digest: string; origin: string; revision: number };
type RemovalProof = { time: ActionTime | null; revision: number };

function authoredDigest(row: DocumentData): string {
  const { id: _id, ...value } = row;
  return rowDigest(value);
}

function proofTime(value: unknown): ActionTime | null {
  return boundedActionTime(value) ?? null;
}

function readRemovals(raw: unknown, current: ResourceSnapshot) {
  const entries = object(raw) && raw.generation === current.metadata?.generation && Array.isArray(raw[REMOVAL_FIELD]) ? raw[REMOVAL_FIELD] : [];
  const result = new Map<string, RemovalProof>();
  for (const proof of entries.slice(-MAX_REMOVALS)) {
    if (!object(proof) || typeof proof.digest !== 'string' || !validRevision(proof.revision, current)) continue;
    result.set(proof.digest, { time: proofTime(proof.time), revision: proof.revision });
  }
  return result;
}

function validRevision(revision: unknown, current: ResourceSnapshot): revision is number {
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 1 && revision <= (current.metadata?.revision ?? 0);
}

function currentTimes(raw: unknown, current: ResourceSnapshot) {
  const proofs = object(raw) && raw.generation === current.metadata?.generation && object(raw[PROOF_FIELD])
    ? raw[PROOF_FIELD] : {};
  const rows = current.value && referenceRows(readField(current.value, studyNoteReferencesPath));
  const kept = new Map<string, ReferenceProof>();
  for (const row of rows || []) {
    const proof = Object.hasOwn(proofs, row.id) ? proofs[row.id] : undefined;
    const digest = rowDigest(row);
    if (object(proof) && proof.digest === digest && typeof proof.origin === 'string' && validRevision(proof.revision, current)) {
      kept.set(row.id, { time: proofTime(proof.time), digest, origin: proof.origin, revision: proof.revision });
    }
  }
  return kept;
}

const chronology = (time: ActionTime | undefined, stored: ActionTime | null | undefined) =>
  time && stored ? compareActionTime(time, stored) : 0;

export function planStudyNoteReferenceOrder(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  if (command.kind !== 'update' || command.resource.collection !== 'studyNotes' || command.generation !== current.metadata?.generation
    || !isOrdinaryReferenceDocument(current.value)) return undefined;
  // A writer that sends no reference evidence (the study-note page until it moves to the engine's editing session,
  // and older app versions) is not ordered against the removal journal: its own re-added passage is not a version
  // question. It keeps the plain base check (BUG-20261118-note-page-codex-fixes-wait-for-engine-session).
  if (!object(command.studyNoteReferenceObservedRevisions) && !object(command.studyNoteReferenceTimes)) return undefined;
  const change = command.changes.find(item => equalValues(item.path, studyNoteReferencesPath));
  const before = change && referenceRows(change.before), after = change && referenceRows(change.after);
  const saved = referenceRows(readField(current.value, studyNoteReferencesPath));
  if (!before || !after || !saved) return undefined;
  const observed = new Map(before.map(row => [row.id, row]));
  const requested = new Map(after.map(row => [row.id, row]));
  const previous = currentTimes(raw, current);
  const observations = command.studyNoteReferenceObservedRevisions;
  const observedRevision = (id: string) => {
    const revision = object(observations) && Object.hasOwn(observations, id) ? observations[id] : undefined;
    return validRevision(revision, current) ? revision : 0;
  };
  const times = new Map<string, ActionTime>();
  const supplied = command.studyNoteReferenceTimes;
  if (Number.isFinite(serverMs) && object(supplied)) {
    for (const id of new Set([...observed.keys(), ...requested.keys()])) {
      if (equalValues(observed.get(id), requested.get(id)) || !Object.hasOwn(supplied, id)) continue;
      const time = boundedActionTime(supplied[id]);
      if (time && time.latestMs <= serverMs + 5) times.set(id, time);
    }
  }
  const displaced: StudyNoteReferenceHistoryEntry[] = [];
  const retainEarlier = (rowId: string, incoming: ReferenceRow | undefined, stored: ReferenceRow | undefined,
    incomingTime: ActionTime, storedTime: ActionTime, when: -1 | 1) => {
    const requested = incoming ? { ...incoming, id: rowId } : null;
    const saved = stored ?? null;
    if (equalValues(requested, saved)) return;
    displaced.push({ rowId, value: when > 0 ? saved : requested, winner: when > 0 ? requested : saved,
      actionTime: when > 0 ? storedTime : incomingTime, winnerActionTime: when > 0 ? incomingTime : storedTime });
  };
  const removals = readRemovals(raw, current);
  const aliasTargets = new Set(current.metadata?.studyNoteReferenceAliases?.map(alias => alias.to));
  const order: StudyNoteReferenceOrder = {
    change(authoredId, stored) {
      const proof = previous.get(stored.id);
      if (authoredId === stored.id && observedRevision(authoredId) >= (proof?.revision ?? current.metadata!.revision)) return 0;
      const time = times.get(authoredId);
      const when = chronology(time, proof?.time);
      const aliasTarget = aliasTargets.has(stored.id);
      // A normal edit of the row already seen by this device does not displace a competing action.
      if (when && time && proof?.time && (authoredId !== stored.id || aliasTarget || !equalValues(observed.get(authoredId), stored))) {
        retainEarlier(stored.id, requested.get(authoredId), stored, time, proof.time, when);
      }
      return when || (aliasTarget ? 'review' : 0);
    },
    addition(authored) {
      const digest = authoredDigest(authored), time = times.get(authored.id);
      const removed = removals.get(digest);
      const applicableRemoval = removed && observedRevision(authored.id) < removed.revision ? removed : undefined;
      const removalTime = applicableRemoval?.time;
      const whenRemoved = chronology(time, removalTime);
      if (applicableRemoval && !whenRemoved) return 'review';
      if (whenRemoved === -1 && time && removalTime) {
        retainEarlier(authored.id, authored, undefined, time, removalTime, whenRemoved);
        return 'skip';
      }
      if (saved.some(row => authoredDigest(row) === digest)) return 'keep';
      const origins = saved.filter(row => {
        const proof = previous.get(row.id);
        return proof?.origin === digest && proof.origin !== authoredDigest(row) && !observed.has(row.id);
      });
      const stored = origins.length === 1 ? origins[0] : undefined;
      const proof = stored && previous.get(stored.id);
      if (stored && proof && observedRevision(authored.id) < proof.revision) {
        return { stored, chronology: chronology(time, proof.time) };
      }
      if (whenRemoved === 1 && time && removalTime) retainEarlier(authored.id, authored, undefined, time, removalTime, whenRemoved);
      return 'keep';
    },
    coalescedAddition(authored, stored, when) {
      const time = times.get(authored.id), storedTime = previous.get(stored.id)?.time;
      if (time && storedTime) retainEarlier(stored.id, authored, stored, time, storedTime, when);
    },
  };
  return { order, observed, requested, times, previous, removals, displaced };
}

export function retainedStudyNoteReferenceHistory(snapshot: ResourceSnapshot, plan?: ReturnType<typeof planStudyNoteReferenceOrder>,
  comparison = false): StudyNoteReferenceHistoryEntry[] {
  if (!plan?.displaced.length || !snapshot.metadata || !isOrdinaryReferenceDocument(snapshot.value)) return [];
  const references = referenceRows(readField(snapshot.value, studyNoteReferencesPath));
  if (!references) return [];
  const live = new Map(references.map(row => [row.id, row]));
  return plan.displaced.flatMap(entry => {
    const applied = equalValues(live.get(entry.rowId) ?? null, entry.winner);
    if (!applied && !comparison) return [];
    const stored: StudyNoteReferenceHistoryEntry = applied ? entry : { ...entry, origin: 'comparison' };
    // A losing payload never enters the document validator. Check both values
    // before committing anything that the note could not have accepted.
    try {
      for (const reference of [entry.value, entry.winner]) {
        if (reference) validateResourceDocument('studyNotes', { scriptureRefs: [reference] },
          { kind: 'update', changedFields: ['scriptureRefs'] });
      }
      return [stored];
    } catch {
      return [];
    }
  });
}

export const REFERENCE_HISTORY_PARTS = '_parts';
const MAX_HISTORY_PARTS = 20;

export function splitLargeStudyNoteReferenceHistory(entry: StudyNoteReferenceHistoryEntry) {
  const value = { entries: [entry] };
  try {
    validateResourceDocument('studyNotes', value, { kind: 'update', changedFields: [] });
    if (documentProofHeadroom(value, undefined) >= 0) return;
  } catch { /* A JSON string also avoids Firestore's map and array depth limit. */ }
  const json = JSON.stringify(entry);
  const parts = splitConflictJson(json, MAX_HISTORY_PARTS);
  if (!parts) throw new Error('Study note reference history exceeds its input bound');
  return { parts, digest: conflictReceiptDigest(json) };
}

export async function readSplitStudyNoteReferenceHistory(count: unknown, digest: unknown, read: (index: number) => Promise<unknown>) {
  if (!validConflictPartCount(count, MAX_HISTORY_PARTS) || typeof digest !== 'string') return;
  const parts = await Promise.all(Array.from({ length: count }, (_, index) => read(index)));
  const entry = readConflictJsonParts(parts, count, digest);
  if (object(entry) && typeof entry.rowId === 'string') return entry as StudyNoteReferenceHistoryEntry;
}

function newestTime(before: ActionTime | null, after: ActionTime | null): ActionTime | null {
  if (!before || !after) return null;
  return { earliestMs: Math.max(before.earliestMs, after.earliestMs), latestMs: Math.max(before.latestMs, after.latestMs) };
}

export function metadataAfterStudyNoteReferences(metadata: EngineMetadata | null | undefined, snapshot: ResourceSnapshot, prior: ResourceSnapshot, raw: unknown,
  plan?: ReturnType<typeof planStudyNoteReferenceOrder>) {
  if (!metadata || snapshot.resource.collection !== 'studyNotes' || !isOrdinaryReferenceDocument(snapshot.value)) return metadata;
  const rows = referenceRows(readField(snapshot.value, studyNoteReferencesPath));
  if (!rows) return metadata;
  const previous = plan?.previous ?? currentTimes(raw, prior);
  const removals = plan?.removals ?? readRemovals(raw, prior);
  const aliases = metadata.studyNoteReferenceAliases ?? [];
  const canonical = new Map(aliases.map(({ from, to }) => [from, to]));
  const newAliases = new Set(aliases.filter(alias => !prior.metadata?.studyNoteReferenceAliases?.some(old => old.from === alias.from)).map(alias => alias.from));
  const live = new Map(rows.map(row => [row.id, row]));
  const previousRows = prior.value ? referenceRows(readField(prior.value, studyNoteReferencesPath)) ?? [] : [];
  const previouslyLive = new Map(previousRows.map(row => [row.id, row]));
  const accepted = new Map<string, ReferenceProof>();
  for (const row of rows) {
    const proof = previous.get(row.id);
    if (proof) accepted.set(row.id, proof);
  }
  for (const [id, requested] of plan?.requested ?? []) {
    const opening = plan?.observed.get(id);
    if (equalValues(opening, requested)) continue;
    const canonicalId = canonical.get(id) ?? id, stored = live.get(canonicalId);
    if (!stored) continue;
    const time = plan?.times.get(id) ?? null;
    const proof = accepted.get(canonicalId);
    const digest = rowDigest(stored);
    const origin = proof?.origin ?? authoredDigest(opening ?? requested);
    if (equalValues(stored, { ...requested, id: canonicalId })) {
      if (!proof || proof.digest !== digest || newAliases.has(id)) {
        accepted.set(canonicalId, { digest, origin, revision: metadata.revision,
          time: newAliases.has(id) && proof?.digest === digest ? newestTime(proof.time, time) : time });
      }
    } else if (newAliases.has(id) && proof) {
      accepted.set(canonicalId, { ...proof, revision: metadata.revision });
    }
  }
  for (const [id, opening] of plan?.observed ?? []) {
    const canonicalId = canonical.get(id) ?? id;
    const removed = previouslyLive.get(canonicalId);
    if (plan?.requested.has(id) || live.has(canonicalId) || !removed) continue;
    const time = plan?.times.get(id) ?? null;
    for (const digest of new Set([authoredDigest(opening), authoredDigest(removed), previous.get(canonicalId)?.origin])) {
      if (!digest) continue;
      removals.delete(digest);
      removals.set(digest, { time, revision: metadata.revision });
    }
  }
  const entries = rows.flatMap(row => {
    const proof = accepted.get(row.id);
    return proof?.digest === rowDigest(row) ? [[row.id, proof] as const] : [];
  });
  const ledger = [...removals].slice(-MAX_REMOVALS).map(([digest, proof]) => ({ digest, ...proof }));
  if (!entries.length && !ledger.length) return metadata;
  const proofs = { ...metadata, ...(entries.length && { [PROOF_FIELD]: Object.fromEntries(entries) }),
    ...(ledger.length && { [REMOVAL_FIELD]: ledger }) };
  return documentProofHeadroom(snapshot.value, proofs) >= 0 ? proofs : metadata;
}
