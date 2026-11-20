import { boundedActionTime } from './actionClock';
import { datedRowTarget, existingRowDate, isDateChange, MEETING_DATE_TARGET } from './datedRowAction';
import { object } from './fieldValues';
import { isValidIdentifier } from './protocol';
import { rowDetailConflict } from './rowDetailAction';
import { boundedRowId, existingRowField, existingRowFields, proofRevision } from './rowFieldAction';
import { orderConcurrentRowField, readRowObservation, uncertainRowChange } from './rowFieldOrder.server';

import type { ActionTime } from './actionClock';
import type { DatedRowActionEvidence, DatedRowTarget, DisplacedRowDate } from './datedRowAction';
import type { ConflictDetail, DataCommand, ResourceSnapshot } from './types';

const MAX_PROOFS = 32;
const MAX_EVICTED_ROWS = 256;
const MAX_PRIOR_MEETING_DATES = 8;
type Proof = { rowId: string; date: string; time: ActionTime | null; revision: number; operationId?: string; rowCreatedAt?: string; pastDates?: string[] | null };
type DateOrder = { command: DataCommand; target?: DatedRowTarget; action?: DatedRowActionEvidence; displaced?: DisplacedRowDate;
  kept?: Proof; coalesced?: Pick<Proof, 'rowId' | 'date' | 'time'>; uncertain?: ConflictDetail[] };

function proofs(rawMetadata: unknown, target: DatedRowTarget): Proof[] {
  const entries = object(rawMetadata) ? rawMetadata[target.proofs] : undefined;
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, MAX_PROOFS).flatMap((item: unknown) => {
    if (!object(item) || !boundedRowId(item.rowId) || !target.accepts(item.date) || !proofRevision(item.revision)) return [];
    const time = item.time === null && target === MEETING_DATE_TARGET ? null : boundedActionTime(item.time);
    const operationId = isValidIdentifier(item.operationId) ? item.operationId : undefined;
    const rowCreatedAt = target.birth.accepts(item.rowCreatedAt) ? item.rowCreatedAt : undefined;
    const pastDates = target === MEETING_DATE_TARGET && item.pastDates !== undefined
      ? Array.isArray(item.pastDates) && item.pastDates.length <= MAX_PRIOR_MEETING_DATES && item.pastDates.every(target.accepts)
        ? item.pastDates : null
      : undefined;
    return time === undefined ? [] : [{ rowId: item.rowId, date: item.date, time, revision: item.revision,
      ...(rowCreatedAt && { rowCreatedAt, ...(operationId && { operationId }) }),
      ...(pastDates !== undefined && { pastDates }) }];
  });
}

function proofFloorKey(target: DatedRowTarget): string {
  return target === MEETING_DATE_TARGET ? 'meetingDateProofFloor' : 'preachDateProofFloor';
}

function evictionsKey(target: DatedRowTarget): string {
  return target === MEETING_DATE_TARGET ? 'meetingDateProofEvictions' : 'preachDateProofEvictions';
}

function dateProofEvictions(rawMetadata: unknown, target: DatedRowTarget, revision: number) {
  const raw = object(rawMetadata) ? rawMetadata : {};
  const legacy = raw[proofFloorKey(target)];
  const saved = raw[evictionsKey(target)];
  const rows = new Map<string, number>();
  if (legacy === undefined && saved === undefined) return { rows, older: 0, floor: 0 };
  const legacyFloor = proofRevision(legacy) ? Math.min(legacy, revision) : 0;
  let highest = 0, malformed = false;
  const candidates = object(saved) && Array.isArray(saved.rows) ? saved.rows : [];
  if (candidates.length > MAX_EVICTED_ROWS) return { rows, older: revision, floor: revision };
  for (const row of candidates) {
    const knownRevision = object(row) && proofRevision(row.revision) ? Math.min(row.revision, revision) : 0;
    highest = Math.max(highest, knownRevision);
    if (!knownRevision || !object(row) || row.revision !== knownRevision || !boundedRowId(row.rowId) || rows.has(row.rowId)) malformed = true;
    else rows.set(row.rowId, knownRevision);
  }
  const savedFloor = object(saved) && proofRevision(saved.floor) ? Math.min(saved.floor, revision) : 0;
  const older = object(saved) && proofRevision(saved.older) ? Math.min(saved.older, revision) : 0;
  const floor = Math.max(legacyFloor, savedFloor, older, highest);
  // Older writers preserve the legacy floor and can drop the finer evidence.
  if (!object(saved) || saved.floor !== floor || legacyFloor !== floor || !Array.isArray(saved.rows)
    || malformed || saved.older !== older || Math.max(older, highest) !== floor) {
    rows.clear();
    const conservative = floor || revision;
    return { rows, older: conservative, floor: conservative };
  }
  return { rows, older, floor };
}

function dateProofFloor(rawMetadata: unknown, target: DatedRowTarget, revision: number, rowId: string): number {
  const { rows, older } = dateProofEvictions(rawMetadata, target, revision);
  return Math.max(older, rows.get(rowId) ?? 0);
}

function uncertainDate(command: DataCommand, action: DatedRowActionEvidence, target: DatedRowTarget): DateOrder {
  return { command, uncertain: [uncertainRowChange(action, target)] };
}

function compareUnobservedDate(command: Extract<DataCommand, { kind: 'update' }>, target: DatedRowTarget,
  action: DatedRowActionEvidence, previous: Proof): DateOrder {
  const { date, time } = previous;
  if (!action.time) {
    if (date === action.after) return { command, coalesced: { rowId: action.rowId, date, time: null } };
    return date === action.before ? uncertainDate(command, action, target) : { command };
  }
  const ordered = orderConcurrentRowField(command, { ...action, time: action.time }, target, { value: date, time });
  const { chronology, displaced } = ordered;
  if (date === action.after) {
    if (chronology > 0) return { command, action };
    if (chronology < 0) return { command, kept: previous };
    if (target === MEETING_DATE_TARGET) {
      // The later of two equal actions can fall anywhere in this combined interval.
      const latest = time ? { earliestMs: Math.max(time.earliestMs, action.time.earliestMs),
        latestMs: Math.max(time.latestMs, action.time.latestMs) } : null;
      return { command, coalesced: { rowId: action.rowId, date, time: latest } };
    }
    return { command };
  }
  if (!displaced) {
    return target === MEETING_DATE_TARGET && action.before === date ? uncertainDate(command, action, target) : { command };
  }
  const { value, winnerValue, ...details } = displaced;
  return { command: ordered.command, target,
    ...(chronology < 0 ? { kept: previous } : { action }),
    displaced: { ...details, date: value, winnerDate: winnerValue } };
}

function orderUnprovedMeetingDate(command: Extract<DataCommand, { kind: 'update' }>, current: ResourceSnapshot,
  raw: unknown, knownOpeningRow: string | undefined): DateOrder {
  const target = MEETING_DATE_TARGET;
  const change = command.changes.find(item => isDateChange(item, target));
  if (!change || !current.metadata) return { command };
  const { revision } = current.metadata;
  const stored = current.value?.meetingDates;
  const beginnings = existingRowFields(change.before.value, target.birth);
  const endings = existingRowFields(change.after.value, target.birth);
  const births = existingRowFields(stored, target.birth);
  const openings = existingRowFields(change.before.value, target);
  const liveDates = existingRowFields(stored, target);
  const previous = new Map(proofs(raw, target).filter(proof => proof.revision <= revision).map(proof => [proof.rowId, proof]));
  const result: DateOrder = { command };
  const uncertain: ConflictDetail[] = [];
  for (const [rowId, after] of existingRowFields(change.after.value, target)) {
    const before = openings.get(rowId), live = liveDates.get(rowId), birth = births.get(rowId);
    if (!birth || beginnings.get(rowId) !== birth || endings.get(rowId) !== birth
      || before === undefined || after === undefined || before === after) continue;
    if (live === after) {
      result.coalesced = { rowId, date: after, time: null };
      continue;
    }
    if (before !== live) continue;
    const proof = previous.get(rowId);
    const matching = proof?.date === live && (!proof.rowCreatedAt || proof.rowCreatedAt === birth) ? proof : undefined;
    const returned = matching?.pastDates === null || matching?.pastDates?.includes(before)
      || (before === '' && rowId === knownOpeningRow && Boolean(matching));
    const evicted = dateProofFloor(raw, target, revision, rowId);
    // The first document revision can evict only a creation, never a return.
    if (returned || (!matching && evicted > (rowId === knownOpeningRow ? 0 : 1))) {
      uncertain.push(uncertainRowChange({ rowId, before, after, time: null, observedRevision: 0 }, target));
    }
  }
  return uncertain.length ? { ...result, uncertain } : result;
}

/** The ordinary merge still decides every neighboring field, row identity and permission. */
export function orderDatedRow(command: DataCommand, current: ResourceSnapshot, rawMetadata: unknown, readTimeMs: number, knownOpeningRow?: string): DateOrder {
  const target = datedRowTarget(command.resource.collection);
  if (!target || command.kind !== 'update' || !current.metadata
    || current.metadata.deleted || command.generation !== current.metadata.generation) return { command };
  const submitted = command[target.evidence];
  const action = readRowObservation(command, submitted, target, readTimeMs, { allowUnclocked: target === MEETING_DATE_TARGET });
  if (!action || action.observedRevision > current.metadata.revision) {
    return target === MEETING_DATE_TARGET ? orderUnprovedMeetingDate(command, current, rawMetadata, knownOpeningRow) : { command };
  }
  const rows = current.value?.[target.field];
  const currentDate = existingRowDate(rows, action.rowId, target);
  if (currentDate === undefined) return { command };
  const birth = existingRowField(rows, action.rowId, target.birth);
  if (target === MEETING_DATE_TARGET) {
    const change = command.changes.find(item => isDateChange(item, target));
    const opening = existingRowField(change?.before.value, action.rowId, target.birth);
    const proposed = existingRowField(change?.after.value, action.rowId, target.birth);
    if (opening && opening === proposed && birth && opening !== birth && currentDate !== action.after) {
      return { command, uncertain: [rowDetailConflict({ ...action, rowCreatedAt: opening }, target, currentDate)] };
    }
    if (!birth || opening !== birth || proposed !== birth) return { command };
  }
  const previous = proofs(rawMetadata, target).find(item => item.rowId === action.rowId && item.date === currentDate
    && (!item.rowCreatedAt || item.rowCreatedAt === birth) && item.revision <= current.metadata!.revision);
  if (previous && previous.revision > action.observedRevision) {
    if (previous.operationId && previous.operationId === submitted?.predecessorOperationId && currentDate === action.before) {
      const change = command.changes.find(item => isDateChange(item, target));
      if (change && birth && previous.rowCreatedAt === birth
        && existingRowField(change.before.value, action.rowId, target.birth) === birth
        && existingRowField(change.after.value, action.rowId, target.birth) === birth) return { command, action };
    }
    return compareUnobservedDate(command, target, action, previous);
  }
  if (!previous && currentDate === action.before
    && action.observedRevision < dateProofFloor(rawMetadata, target, current.metadata.revision, action.rowId)) return uncertainDate(command, action, target);
  const matchesKnownOpening = knownOpeningRow === action.rowId && currentDate === action.before;
  if (!previous && (currentDate === action.after || (target === MEETING_DATE_TARGET && action.observedRevision < current.metadata.revision
    && !matchesKnownOpening))) return { command };
  return { command, action };
}

function meetingDateDepartures(previous: Proof | undefined, opening: string | undefined): string[] | null {
  if (opening === undefined) return [];
  const remembered = previous?.pastDates;
  if (remembered === null) return null;
  const dates = remembered ?? [];
  if (dates.includes(opening)) return dates;
  return dates.length < MAX_PRIOR_MEETING_DATES ? [...dates, opening] : null;
}

function unstampedMeetingDates(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined, previous: readonly Proof[]): Proof[] {
  const target = MEETING_DATE_TARGET;
  const before = existingRowFields(raw?.meetingDates, target);
  const earlierBirths = existingRowFields(raw?.meetingDates, target.birth);
  const births = existingRowFields(snapshot.value?.meetingDates, target.birth);
  const prior = new Map(previous.map(proof => [proof.rowId, proof]));
  return [...existingRowFields(snapshot.value?.meetingDates, target)].flatMap(([rowId, date]) => {
    if (!boundedRowId(rowId) || date === undefined) return [];
    const birth = births.get(rowId);
    const sameRow = birth && earlierBirths.get(rowId) === birth;
    const opening = sameRow ? before.get(rowId) : undefined;
    if (date === opening) return [];
    return [{ rowId, date, revision: snapshot.metadata!.revision, time: null,
      ...(birth && { rowCreatedAt: birth }), pastDates: meetingDateDepartures(prior.get(rowId), opening) }];
  });
}

/** An unstamped meeting edit retires the previous timestamp, even when the date later returns. */
export function metadataAfterDatedRow(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined, submitted: DataCommand | undefined, order?: DateOrder) {
  const target = datedRowTarget(snapshot.resource.collection);
  if (!target || !snapshot.value || !snapshot.metadata) return snapshot.metadata;
  const rows = snapshot.value[target.field];
  const directChange = submitted?.kind === 'update' && submitted.changes.find(change => isDateChange(change, target));
  const previous = proofs(raw?._dataEngine, target);
  const keep = previous.filter(proof => {
    if (existingRowDate(rows, proof.rowId, target) !== proof.date) return false;
    if (!directChange || target === MEETING_DATE_TARGET) return true;
    return existingRowDate(directChange.before.value, proof.rowId, target) === existingRowDate(directChange.after.value, proof.rowId, target);
  }).map(proof => {
    if (!proof.rowCreatedAt || proof.rowCreatedAt === existingRowField(rows, proof.rowId, target.birth)) return proof;
    const { rowId, date, time, revision } = proof;
    return { rowId, date, time, revision };
  });
  if (target === MEETING_DATE_TARGET) keep.unshift(...unstampedMeetingDates(snapshot, raw, previous));
  const action = order?.action;
  if (action && existingRowDate(rows, action.rowId, target) === action.after) {
    const rowCreatedAt = existingRowField(rows, action.rowId, target.birth);
    const { operationId, revision } = snapshot.metadata;
    const opening = keep.find(proof => proof.rowId === action.rowId);
    const reaffirmed = target === MEETING_DATE_TARGET && existingRowField(raw?.meetingDates, action.rowId, target) === action.after;
    keep.unshift({ ...opening, rowId: action.rowId, date: action.after, time: action.time, revision,
      ...(operationId && rowCreatedAt && { operationId, rowCreatedAt }),
      ...(reaffirmed && { pastDates: meetingDateDepartures(opening, action.after) }) });
  } else if (order?.coalesced && existingRowDate(rows, order.coalesced.rowId, target) === order.coalesced.date) {
    const opening = keep.find(proof => proof.rowId === order.coalesced?.rowId);
    keep.unshift({ ...order.coalesced, revision: snapshot.metadata.revision,
      ...(opening?.rowCreatedAt && { rowCreatedAt: opening.rowCreatedAt }),
      ...(target === MEETING_DATE_TARGET && { pastDates: meetingDateDepartures(opening, order.coalesced.date) }) });
  } else if (order?.kept) keep.unshift(order.kept);
  const unique = [...new Map(keep.slice().reverse().map(proof => [proof.rowId, proof])).values()].reverse();
  const retained = unique.slice(0, MAX_PROOFS);
  // A retained eviction still names the affected row. Only older, unaddressable gaps apply to every row.
  const evicted = dateProofEvictions(raw?._dataEngine, target, snapshot.metadata.revision);
  for (const proof of unique.slice(MAX_PROOFS)) evicted.rows.set(proof.rowId, Math.max(evicted.rows.get(proof.rowId) ?? 0, proof.revision));
  const ordered = [...evicted.rows].map(([rowId, revision]) => ({ rowId, revision })).sort((a, b) => b.revision - a.revision);
  const older = Math.max(evicted.older, ordered[MAX_EVICTED_ROWS]?.revision ?? 0);
  const floor = Math.max(evicted.floor, ordered[0]?.revision ?? 0);
  return { ...snapshot.metadata, ...(retained.length && { [target.proofs]: retained }),
    ...(floor && { [proofFloorKey(target)]: floor, [evictionsKey(target)]: { floor, older, rows: ordered.slice(0, MAX_EVICTED_ROWS) } }) };
}
