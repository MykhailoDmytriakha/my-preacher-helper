import { createHash } from 'node:crypto';

import { boundedActionTime, compareActionTime } from './actionClock';
import { ANALYSIS_RESHAPE_FRAME, sameAnalysisFrame } from './analysisReshapeFields';
import { commandFingerprint, equalValues, object, readField } from './fieldValues';
import { proofRevision } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { ConflictDetail, DataCommand, DocumentData, FieldValue, ResourceSnapshot } from './types';

const PROOF = 'analysisFrameReturn';
const MAX_OPENINGS = 16;
const digest = (value: unknown) => createHash('sha256').update(commandFingerprint(value)).digest('base64url');
const frame = (value: DocumentData) => ANALYSIS_RESHAPE_FRAME.map(field => readField(value, [field]));

type FrameProof = {
  generation: string;
  digest: string;
  revision: number;
  through?: number;
  actionTime?: ActionTime;
  openings: { digest: string; replacedAt: number }[];
};

function proof(metadata: unknown, current: ResourceSnapshot): FrameProof | undefined {
  const raw = object(metadata) ? metadata[PROOF] : undefined;
  if (!object(raw) || !current.value || !current.metadata || typeof raw.generation !== 'string'
    || raw.generation !== current.metadata.generation || !proofRevision(raw.revision) || raw.revision > current.metadata.revision
    || typeof raw.digest !== 'string' || raw.digest !== digest(frame(current.value))
    || (raw.through !== undefined && (!proofRevision(raw.through) || raw.through > raw.revision))
    || !Array.isArray(raw.openings) || raw.openings.length > MAX_OPENINGS
    || raw.openings.some(entry => !object(entry) || typeof entry.digest !== 'string' || !proofRevision(entry.replacedAt)
      || entry.replacedAt > (raw.revision as number))) return;
  const { actionTime: candidate, ...stored } = raw;
  const actionTime = boundedActionTime(candidate);
  return { ...stored, ...(actionTime && { actionTime }) } as unknown as FrameProof;
}

export type AnalysisFrameOrder = {
  command: DataCommand;
  conflicts: ConflictDetail[];
  accepted?: { expected: readonly FieldValue[]; time: ActionTime };
  displaced?: { values: readonly FieldValue[]; winnerDigest: string; time: ActionTime; winnerTime: ActionTime };
};

/** Equal frames can conceal an intervening change and explicit return. Keep all three roots together. */
export function orderAnalysisFrame(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs?: number): AnalysisFrameOrder {
  const unchanged = { command, conflicts: [] };
  if (command.kind !== 'update' || current.resource.collection !== 'studyNotes' || current.value?.type !== 'analysis'
    || !current.metadata || current.metadata.generation !== command.generation) return unchanged;
  const changes = ANALYSIS_RESHAPE_FRAME.map(field => command.changes.find(change => change.path.length === 1 && change.path[0] === field));
  if (!changes.every(change => change !== undefined) || changes.every(change => equalValues(change.before, change.after))) return unchanged;
  const currentFrame = frame(current.value), before = changes.map(change => change.before), after = changes.map(change => change.after);
  if (!equalValues(currentFrame, before)) return unchanged;

  const observed = command.analysisFrameObservedRevision;
  const known = proof(raw, current);
  const submitted = boundedActionTime(command.analysisFrameActionTime);
  const time = submitted && observed !== undefined && observed <= current.metadata.revision
    && serverMs !== undefined && Number.isFinite(serverMs) && submitted.earliestMs <= serverMs + 5 ? submitted : undefined;
  const returned = known?.openings.some(entry => entry.digest === known.digest
    && (observed === undefined || entry.replacedAt > observed));
  const beyondRetention = known?.through !== undefined && (observed === undefined || observed < known.through);
  const unreadable = object(raw) && raw[PROOF] !== undefined && !known && (observed === undefined || observed !== current.metadata.revision);
  const accepted = time ? { expected: after, time } : undefined;
  if (!returned && !beyondRetention && !unreadable) return accepted ? { ...unchanged, accepted } : unchanged;

  if (returned && !beyondRetention && known?.actionTime && time) {
    const order = compareActionTime(time, known.actionTime);
    if (order > 0) return { ...unchanged, accepted,
      displaced: { values: currentFrame, winnerDigest: digest(after), time: known.actionTime, winnerTime: time } };
    if (order < 0) return {
      command: { ...command, changes: command.changes.map(change => changes.includes(change) ? { ...change, after: change.before } : change) },
      conflicts: [], displaced: { values: after, winnerDigest: known.digest, time, winnerTime: known.actionTime },
    };
  }
  return { command, conflicts: changes.map((change, index) => ({ path: change.path, base: change.before, mine: change.after, theirs: currentFrame[index] })) };
}

export function compareReturnedAnalysisFrame(command: DataCommand, current: ResourceSnapshot, raw: unknown): ConflictDetail[] {
  return orderAnalysisFrame(command, current, raw).conflicts;
}

/** Track departures for the whole frame, even when an older client or relation made the change. */
export function metadataAfterAnalysisFrame(snapshot: ResourceSnapshot, previous: ResourceSnapshot, raw: unknown,
  accepted?: AnalysisFrameOrder['accepted']) {
  const metadata = snapshot.metadata;
  if (snapshot.resource.collection !== 'studyNotes' || snapshot.value?.type !== 'analysis' || !metadata) return metadata;
  const previousFrame = previous.value?.type === 'analysis' && previous.metadata?.generation === metadata.generation ? previous.value : null;
  const known = previousFrame ? proof(raw, previous) : undefined;
  if (known && sameAnalysisFrame(previousFrame, snapshot.value)) return { ...metadata, [PROOF]: known };
  const openings = known?.openings.slice() ?? [];
  let through = known?.through;
  if (previousFrame && !sameAnalysisFrame(previousFrame, snapshot.value)) {
    const opening = digest(frame(previousFrame));
    const existing = openings.findIndex(entry => entry.digest === opening);
    if (existing >= 0) openings.splice(existing, 1);
    openings.push({ digest: opening, replacedAt: metadata.revision });
    if (openings.length > MAX_OPENINGS) through = Math.max(through ?? 0, openings.shift()!.replacedAt);
  }
  if (previousFrame && !known && object(raw) && raw[PROOF] !== undefined) {
    through = Math.max(through ?? 0, metadata.revision);
  }
  const values = frame(snapshot.value);
  const next: FrameProof = { generation: metadata.generation, digest: digest(values), revision: metadata.revision,
    openings, ...(through !== undefined && { through }),
    ...(accepted && equalValues(values, accepted.expected) && { actionTime: accepted.time }) };
  return { ...metadata, [PROOF]: next };
}
