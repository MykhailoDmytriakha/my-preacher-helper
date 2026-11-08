import { boundedActionTime, compareActionTime } from './actionClock';
import { object } from './fieldValues';
import { existingPreachDate, matchesPreachDateChange, replaceExistingDate, type PreachDateActionEvidence } from './preachDateAction';

import type { ActionTime } from './actionClock';
import type { DisplacedPreachDate } from './preachDateAction';
import type { DataCommand, FieldChange, ResourceSnapshot } from './types';

const MAX_PROOFS = 32;

export const PREACH_DATE_HISTORY = '_preachDateHistory';

type Proof = { rowId: string; date: string; time: ActionTime; revision: number };
type DateOrder = { command: DataCommand; action?: PreachDateActionEvidence; displaced?: DisplacedPreachDate; kept?: Proof };

const boundedRow = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;
const dateOnly = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function actionFrom(command: Extract<DataCommand, { kind: 'update' }>, readTimeMs: number): PreachDateActionEvidence | undefined {
  const action: unknown = command.preachDateAction;
  if (!object(action) || !boundedRow(action.rowId)
    || !dateOnly(action.before) || !dateOnly(action.after) || action.before === action.after
    || !revision(action.observedRevision) || !Number.isFinite(readTimeMs)) return undefined;
  const time = boundedActionTime(action.time);
  if (!time) return undefined;
  const evidence = { rowId: action.rowId, time, before: action.before, after: action.after, observedRevision: action.observedRevision };
  if (evidence.time.earliestMs > readTimeMs + 5 || !matchesPreachDateChange(command.changes, evidence)) return undefined;
  return evidence;
}

function proofs(rawMetadata: unknown): Proof[] {
  if (!object(rawMetadata) || !Array.isArray(rawMetadata.preachDateActions)) return [];
  return rawMetadata.preachDateActions.slice(0, MAX_PROOFS).flatMap((item: unknown) => {
    if (!object(item) || !boundedRow(item.rowId) || !dateOnly(item.date) || !revision(item.revision)) return [];
    const time = boundedActionTime(item.time);
    return time ? [{ rowId: item.rowId, date: item.date, time, revision: item.revision }] : [];
  });
}

function isDateChange(change: FieldChange): boolean {
  return change.path.length === 1 && change.path[0] === 'preachDates';
}

function foldDateChange(change: FieldChange, rowId: string, date: string, keepStored: boolean): FieldChange {
  if (!isDateChange(change)) return change;
  return {
    ...change,
    before: { ...change.before, value: replaceExistingDate(change.before.value, rowId, date) },
    after: keepStored ? { ...change.after, value: replaceExistingDate(change.after.value, rowId, date) } : change.after,
  };
}

/** The existing merge still decides every other leaf, the document generation and permissions. */
export function orderPreachDate(command: DataCommand, current: ResourceSnapshot, rawMetadata: unknown, readTimeMs: number): DateOrder {
  if (command.kind !== 'update' || command.resource.collection !== 'sermons' || !current.metadata
    || current.metadata.deleted || command.generation !== current.metadata.generation) return { command };
  const action = actionFrom(command, readTimeMs);
  if (!action || action.observedRevision > current.metadata.revision) return { command };
  const currentDate = existingPreachDate(current.value?.preachDates, action.rowId);
  if (!currentDate) return { command };
  const previous = proofs(rawMetadata).find(item => item.rowId === action.rowId && item.date === currentDate
    && item.revision <= current.metadata!.revision);
  // An unchanged date can already be somebody's uncalibrated action. A matching
  // delivery alone cannot retroactively assign it a time.
  if (!previous) return currentDate === action.after ? { command } : { command, action };
  if (previous.revision <= action.observedRevision) return { command, action };
  const order = compareActionTime(action.time, previous.time);
  const older = order < 0, newer = order > 0;
  if (currentDate === action.after) {
    if (older) return { command, kept: previous };
    return newer ? { command, action } : { command };
  }
  if (!older && !newer) return { command };
  const displaced = { rowId: action.rowId, generation: command.generation!, date: older ? action.after : currentDate,
    winnerDate: older ? currentDate : action.after,
    actionTime: older ? action.time : previous.time, winnerActionTime: older ? previous.time : action.time };
  const changes = command.changes.map(change => foldDateChange(change, action.rowId, currentDate, older));
  return { command: { ...command, changes }, action: older ? undefined : action, kept: older ? previous : undefined, displaced };
}

/** Keep evidence only while that exact date survives; an unstamped date edit retires it. */
export function metadataAfterPreachDate(snapshot: ResourceSnapshot, rawMetadata: unknown, submitted: DataCommand | undefined, order?: DateOrder) {
  if (snapshot.resource.collection !== 'sermons' || !snapshot.value || !snapshot.metadata) return snapshot.metadata;
  const directChange = submitted?.kind === 'update' && submitted.changes.find(isDateChange);
  const keep = proofs(rawMetadata).filter(proof => {
    if (existingPreachDate(snapshot.value?.preachDates, proof.rowId) !== proof.date) return false;
    if (!directChange) return true;
    return existingPreachDate(directChange.before.value, proof.rowId) === existingPreachDate(directChange.after.value, proof.rowId);
  });
  const action = order?.action;
  if (action && existingPreachDate(snapshot.value.preachDates, action.rowId) === action.after) {
    keep.unshift({ rowId: action.rowId, date: action.after, time: action.time, revision: snapshot.metadata.revision });
  } else if (order?.kept) keep.unshift(order.kept);
  const unique = [...new Map(keep.slice().reverse().map(proof => [proof.rowId, proof])).values()].reverse().slice(0, MAX_PROOFS);
  return unique.length ? { ...snapshot.metadata, preachDateActions: unique } : snapshot.metadata;
}
