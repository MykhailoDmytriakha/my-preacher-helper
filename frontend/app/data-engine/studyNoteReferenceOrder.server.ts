import { createHash } from 'node:crypto';

import { boundedActionTime, compareActionTime } from './actionClock';
import { documentProofHeadroom } from './documentProofBudget.server';
import { commandFingerprint, equalValues, object, readField } from './fieldValues';
import { isOrdinaryReferenceDocument, referenceRows, studyNoteReferencesPath } from './studyNoteReferenceMerge';

import type { ActionTime } from './actionClock';
import type { StudyNoteReferenceOrder } from './studyNoteReferenceMerge';
import type { DataCommand, DocumentData, EngineMetadata, ResourceSnapshot } from './types';

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
  const removals = readRemovals(raw, current);
  const aliasTargets = new Set(current.metadata?.studyNoteReferenceAliases?.map(alias => alias.to));
  const order: StudyNoteReferenceOrder = {
    change(authoredId, stored) {
      const proof = previous.get(stored.id);
      if (authoredId === stored.id && observedRevision(authoredId) >= (proof?.revision ?? current.metadata!.revision)) return 0;
      const when = chronology(times.get(authoredId), proof?.time);
      return when || (aliasTargets.has(stored.id) ? 'review' : 0);
    },
    addition(authored) {
      const digest = authoredDigest(authored), time = times.get(authored.id);
      const removed = removals.get(digest);
      if (removed && observedRevision(authored.id) < removed.revision) {
        const when = chronology(time, removed.time);
        if (when < 0) return 'skip';
        if (!when) return 'review';
      }
      if (saved.some(row => authoredDigest(row) === digest)) return 'keep';
      const origins = saved.filter(row => {
        const proof = previous.get(row.id);
        return proof?.origin === digest && proof.origin !== authoredDigest(row) && !observed.has(row.id);
      });
      if (origins.length !== 1) return 'keep';
      const stored = origins[0], proof = previous.get(stored.id)!;
      if (observedRevision(authored.id) >= proof.revision) return 'keep';
      return { stored, chronology: chronology(time, proof.time) };
    },
  };
  return { order, observed, requested, times, previous, removals };
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
