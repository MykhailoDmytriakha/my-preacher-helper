import { boundedActionTime, compareActionTime } from './actionClock';
import { equalValues, object, readField } from './fieldValues';
import { applyHardQuestionPlaceChanges, hardQuestionPlaceDelta, hardQuestionPlaceParts, hardQuestionPlacementConflict,
  hardQuestionPlacementField, isHardQuestionPlace, matchesHardQuestionPlacement, readHardQuestionPlace } from './hardQuestionPlacement';
import { isValidIdentifier } from './protocol';
import { proofRevision } from './rowFieldAction';

import type { HardQuestionPlace, HardQuestionPlacement } from './hardQuestionPlacement';
import type { ConflictDetail, DataCommand, DocumentData, ResourceSnapshot } from './types';

type Update = Extract<DataCommand, { kind: 'update' }>;
type PlacementWrite = Pick<HardQuestionPlacement, 'before' | 'after' | 'time'> & { operationId: string };
type PlacementProof = PlacementWrite & { revision: number; openings?: HardQuestionPlace[]; incomplete?: true };
type PlacementPlan = { command: DataCommand; uncertain: ConflictDetail[]; proof?: PlacementWrite };
type DestinationExists = (place: HardQuestionPlace) => Promise<boolean>;
const PROOF = 'hardQuestionPlacement';
const MAX_OPENINGS = 8;
const sameContainer = (a: HardQuestionPlace, b: HardQuestionPlace) => a.themeId === b.themeId && a.groupId === b.groupId;

function validPlace(value: unknown): value is HardQuestionPlace {
  return isHardQuestionPlace(value) && (value.themeId === null || isValidIdentifier(value.themeId))
    && (value.groupId === null || isValidIdentifier(value.groupId));
}

function readPlacement(command: Update, serverMs: number): HardQuestionPlacement | undefined {
  const move: unknown = command.hardQuestionPlacement;
  if (!object(move) || !validPlace(move.before) || !validPlace(move.after) || !proofRevision(move.observedRevision)
    || (move.reviewed !== undefined && move.reviewed !== true) || !matchesHardQuestionPlacement(command.changes, {
      before: move.before, after: move.after, observedRevision: move.observedRevision, time: null,
    })) return;
  const measured = boundedActionTime(move.time);
  const time = measured && Number.isFinite(serverMs) && measured.earliestMs <= serverMs + 5 ? measured : null;
  return { before: move.before, after: move.after, observedRevision: move.observedRevision, time,
    ...(isValidIdentifier(move.predecessorOperationId) && { predecessorOperationId: move.predecessorOperationId }),
    ...(move.reviewed === true && { reviewed: true }) };
}

function storedPlacement(raw: unknown, stored: HardQuestionPlace, revision: number): PlacementProof | undefined {
  const proof = object(raw) ? raw[PROOF] : undefined;
  if (!object(proof) || !validPlace(proof.before) || !validPlace(proof.after) || !equalValues(proof.after, stored)
    || !proofRevision(proof.revision) || proof.revision > revision || !isValidIdentifier(proof.operationId)) return;
  const time = proof.time === null ? null : boundedActionTime(proof.time);
  const openings = Array.isArray(proof.openings) && proof.openings.length <= MAX_OPENINGS && proof.openings.every(validPlace) ? proof.openings : undefined;
  return time === undefined ? undefined : { before: proof.before, after: proof.after, revision: proof.revision, operationId: proof.operationId, time,
    ...(openings && { openings }), ...(proof.incomplete === true && { incomplete: true }) };
}

function rewritePlacement(command: Update, current: DocumentData, target: HardQuestionPlace, clearBasisDelta: boolean): Update {
  const changesTheme = readHardQuestionPlace(current)?.themeId !== target.themeId;
  const changes = command.changes.filter(({ path }) => !hardQuestionPlacementField(path)
    && (!(clearBasisDelta || changesTheme) || path[0] !== 'basisIds'));
  changes.push(...hardQuestionPlaceDelta(current, target).filter(change => !changes.some(part => part.path[0] === change.path[0])));
  if (!changes.length) {
    const rank = readField(current, ['rank']);
    changes.push({ path: ['rank'], before: rank, after: rank });
  }
  const { hardQuestionPlacement: _placement, ...remaining } = command;
  return { ...remaining, changes };
}

function holdPlacement(command: Update, current: DocumentData, opening: HardQuestionPlace, mine: HardQuestionPlace, stored: HardQuestionPlace,
  unavailable: boolean): PlacementPlan {
  return { command: rewritePlacement(command, current, stored, true), uncertain: [hardQuestionPlacementConflict(opening, mine, stored, unavailable)] };
}

async function orderLegacyPlacement(command: Update, current: DocumentData, stored: HardQuestionPlace, prior: PlacementProof | undefined,
  exists: DestinationExists): Promise<PlacementPlan> {
  const parts = hardQuestionPlaceParts(command.changes);
  const opening = applyHardQuestionPlaceChanges(current, parts, 'before') ?? stored;
  const destination = applyHardQuestionPlaceChanges(current, parts, 'after') ?? stored;
  const explicitTheme = parts.some(({ path }) => path[0] === 'themeId');
  const groupChange = parts.find(({ path }) => path[0] === 'groupId');
  const unscopedGroup = Boolean(groupChange?.after.exists && !destination.themeId);
  const unavailable = unscopedGroup || (!sameContainer(destination, stored) && !await exists(destination));
  if (prior && !explicitTheme && prior.before.themeId !== stored.themeId && groupChange && unavailable) {
    const earlier = { ...current, themeId: prior.before.themeId, groupId: prior.before.groupId };
    const target = applyHardQuestionPlaceChanges(earlier, parts, 'after') ?? destination;
    return holdPlacement(command, current, prior.before, target, stored, !await exists(target));
  }
  if (!unavailable && equalValues(destination, stored)) {
    return { command: rewritePlacement(command, current, stored, false), uncertain: [] };
  }
  const returned = prior?.incomplete || prior?.openings?.some(place => equalValues(place, stored));
  if (!equalValues(opening, stored) || unavailable || returned) {
    return holdPlacement(command, current, opening, destination, stored, unavailable);
  }
  return { command: rewritePlacement(command, current, destination, false), uncertain: [] };
}

/** A theme, group and rank form one destination. No branch merges those fields independently. */
export async function orderHardQuestionPlacement(command: DataCommand, current: ResourceSnapshot, raw: unknown,
  serverMs: number, exists: DestinationExists): Promise<PlacementPlan> {
  if (command.kind !== 'update' || command.resource.collection !== 'hardQuestions' || !current.value || !current.metadata
    || current.metadata.deleted || command.generation !== current.metadata.generation || !hardQuestionPlaceParts(command.changes).length) {
    return { command, uncertain: [] };
  }
  const stored = readHardQuestionPlace(current.value);
  if (!stored) return { command, uncertain: [] };
  const { revision } = current.metadata;
  const prior = storedPlacement(raw, stored, revision);
  const move = readPlacement(command, serverMs);
  if (!move) return orderLegacyPlacement(command, current.value, stored, prior, exists);

  const destinationExists = () => sameContainer(move.after, stored) ? true : exists(move.after);
  const conflict = async () => holdPlacement(command, current.value!, move.before, move.after, stored, !await destinationExists());
  if (move.observedRevision > revision) return conflict();
  const sameOpening = equalValues(move.before, stored);
  const sameDestination = equalValues(move.after, stored);
  const observes = sameOpening && (move.observedRevision === revision || Boolean(prior && (
    move.observedRevision >= prior.revision || (!move.reviewed && prior.operationId === move.predecessorOperationId)
  )));
  const order = move.time && prior?.time ? compareActionTime(move.time, prior.time) : 0;
  const unrelatedBases = move.before.themeId === stored.themeId && move.after.themeId === stored.themeId;
  const keepStored = () => ({ command: rewritePlacement(command, current.value!, stored, !unrelatedBases), uncertain: [] });
  if (!observes && move.reviewed) return sameDestination ? keepStored() : conflict();
  if (!observes) {
    if (sameDestination && order <= 0) return keepStored();
    if (order < 0) return keepStored();
    if (order === 0) return conflict();
  }
  if (!await destinationExists()) return holdPlacement(command, current.value, move.before, move.after, stored, true);
  return { command: rewritePlacement(command, current.value, move.after, !unrelatedBases), uncertain: [],
    proof: { before: stored, after: move.after, time: move.time, operationId: command.operationId } };
}

export function metadataAfterHardQuestionPlacement(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined, proof?: PlacementWrite) {
  const metadata = snapshot.metadata;
  if (snapshot.resource.collection !== 'hardQuestions' || !metadata || !snapshot.value) return metadata;
  const stored = readHardQuestionPlace(snapshot.value);
  if (!stored) return metadata;
  const previous = raw?._dataEngine;
  const before = readHardQuestionPlace(raw as DocumentData | undefined);
  const previousRevision = object(previous) && previous.generation === metadata.generation && proofRevision(previous.revision)
    ? previous.revision : undefined;
  const old = before && previousRevision ? storedPlacement(previous, before, previousRevision) : undefined;
  const unchanged = before && equalValues(before, stored);
  const chosen = proof && equalValues(proof.after, stored) ? { ...proof, revision: metadata.revision }
    : unchanged && old ? old
      : metadata.operationId ? { before: before ?? stored, after: stored, operationId: metadata.operationId, time: null,
        revision: unchanged ? previousRevision ?? metadata.revision : metadata.revision } : undefined;
  if (!chosen) return metadata;
  if (!before || unchanged) return { ...metadata, [PROOF]: { ...chosen, ...(old?.openings && { openings: old.openings }),
    ...(old?.incomplete && { incomplete: true }) } };
  const earlier = (old?.openings ?? []).filter(place => !equalValues(place, before));
  const openings = [...earlier, before].slice(-MAX_OPENINGS);
  const incomplete = old?.incomplete || earlier.length >= MAX_OPENINGS;
  return { ...metadata, [PROOF]: { ...chosen, openings, ...(incomplete && { incomplete: true }) } };
}
