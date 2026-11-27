import { createHash } from 'node:crypto';

import { boundedActionTime, compareActionTime } from './actionClock';
import { isAuthoredStringList } from './authoredStringList';
import { object } from './fieldValues';
import { hardQuestionListItemChanges } from './hardQuestionFieldAction';
import { mergeFields } from './protocol';
import { proofRevision } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { DocumentFieldObservation, DocumentFieldStamp } from './documentFieldAction';
import type { ConflictDetail, FieldChange, FieldValue } from './types';

type Membership = { item: string; revision: number; time: ActionTime | null; operationId?: string; returned?: true };
export type MembershipConfirmation = Pick<Membership, 'item' | 'time'>;
type CarriedMembership = MembershipConfirmation & DocumentFieldStamp;
type ListReview = { carried: readonly CarriedMembership[]; confirmed: readonly string[] };
type Proof = { floor: number; changes: Membership[] };
type MembershipWrite = { time: ActionTime | null; reaffirmed?: readonly MembershipConfirmation[]; carried?: readonly MembershipConfirmation[] };
type ListPlan = { value: FieldValue; reaffirmed: MembershipConfirmation[] }
  | { review: true; versions?: ConflictDetail['hardQuestionListVersions'] };

const MAX_MEMBERSHIPS = 64;
const digest = (item: string) => createHash('sha256').update(JSON.stringify(item)).digest('base64url');
const words = (field: FieldValue) => !field.exists ? [] : isAuthoredStringList(field.value) ? field.value : undefined;
const asField = (list: string[]): FieldValue => ({ exists: true, value: list });

function readMemberships(raw: unknown, revision: number): Proof {
  const proof = object(raw) ? raw.memberships : undefined;
  if (!object(proof) || !proofRevision(proof.floor) || proof.floor > revision || !Array.isArray(proof.changes)) {
    return { floor: revision, changes: [] };
  }
  const changes = proof.changes.slice(0, MAX_MEMBERSHIPS).flatMap(item => {
    if (!object(item) || typeof item.item !== 'string' || !/^[\w-]{43}$/.test(item.item)
      || !proofRevision(item.revision) || item.revision > revision) return [];
    const time = item.time === null ? null : boundedActionTime(item.time);
    return time === undefined ? [] : [{ item: item.item, revision: item.revision, time,
      ...(typeof item.operationId === 'string' && { operationId: item.operationId }),
      ...(item.returned === true && { returned: true as const }) }];
  });
  if (changes.length !== proof.changes.length || new Set(changes.map(entry => entry.item)).size !== changes.length) {
    return { floor: revision, changes: [] };
  }
  return { floor: proof.floor, changes };
}

function changesBetween(before: string[], after: string[]) {
  const opening = new Set(before), requested = new Set(after);
  return { opening, removes: before.filter(item => !requested.has(item)), adds: after.filter(item => !opening.has(item)) };
}

export function planHardQuestionList(change: FieldChange, stored: FieldValue, raw: unknown, revision: number,
  action: DocumentFieldObservation<FieldValue> | undefined, review?: ListReview): ListPlan | undefined {
  const prior = words(change.before), requested = words(change.after), saved = words(stored);
  if (!prior || !requested || !saved || [prior, requested, saved].some(list => new Set(list).size !== list.length)) return;

  const savedItems = new Set(saved);
  const opening = new Set(prior);
  const requestedItems = new Set(requested);
  for (const item of review?.confirmed ?? []) {
    if (savedItems.has(item) !== requestedItems.has(item)) {
      if (requestedItems.has(item)) opening.delete(item);
      else opening.add(item);
    }
  }

  const { floor, changes } = readMemberships(raw, revision);
  const history = new Map(changes.map(entry => [entry.item, entry]));
  const { opening: originalItems, removes, adds } = changesBetween([...opening], requested);
  const carried = new Map(review?.carried.map(item => [item.item, item]));
  const rejected = new Set<string>();
  const uncertain: string[] = [];
  const reaffirmed: MembershipConfirmation[] = [];
  for (const item of [...removes, ...adds]) {
    const key = digest(item);
    const previous = history.get(key);
    const changesSaved = savedItems.has(item) === originalItems.has(item);
    if (!action) {
      if (changesSaved && previous?.returned) uncertain.push(item);
      continue;
    }
    const observed = review ? carried.get(key) : action;
    if (!observed) {
      // Reconfirm the affected item after the explicitly chosen opening became stale.
      if (changesSaved) uncertain.push(item);
      continue;
    }
    const follows = previous ? observed.observedRevision >= previous.revision
      || (previous.operationId && observed.predecessorOperationId === previous.operationId)
      : observed.observedRevision >= floor || observed.observedRevision + 1 >= revision;
    const order = observed.time && previous?.time ? compareActionTime(observed.time, previous.time) : 0;
    if (!changesSaved) {
      // A later explicit action can agree with today's array and still outrank an earlier pending removal or addition.
      if (follows || order >= 0) reaffirmed.push({ item: key, time: follows || order > 0 ? observed.time : null });
    } else if (!follows) {
      if (!order) uncertain.push(item);
      else if (order < 0) rejected.add(item);
    }
  }
  if (!action && !uncertain.length) return;

  const project = (discard: ReadonlySet<string>): FieldValue | undefined => {
    // A rejected removal becomes an addition on the saved side of the three-way comparison.
    const basis = [...opening].filter(item => !discard.has(item));
    const mine = requested.filter(item => originalItems.has(item) || !discard.has(item));
    const merged = mergeFields(asField(basis), asField(mine), asField(saved), change.path);
    if (merged.conflicts.length) return;
    return Array.isArray(merged.value.value) && merged.value.value.length ? merged.value : { exists: false };
  };
  const value = project(rejected);
  if (!value) return { review: true } as const;
  if (uncertain.length) {
    const keep = project(new Set([...rejected, ...uncertain]));
    return { review: true, ...(keep && { versions: { local: value, remote: keep, undecided: uncertain } }) } as const;
  }
  return { value, reaffirmed } as const;
}

export function confirmQuestionItems(raw: unknown, time: ActionTime | null): MembershipConfirmation[] {
  return isAuthoredStringList(raw) ? [...new Set(raw)].map(item => ({ item: digest(item), time })) : [];
}

export function compatibleQuestionConfirmations(items: unknown, action: DocumentFieldStamp, raw: unknown, revision: number) {
  const { floor, changes } = readMemberships(raw, revision);
  const existing = new Map(changes.map(entry => [entry.item, entry]));
  return confirmQuestionItems(items, action.time).filter(({ item }) => {
    const previous = existing.get(item);
    if (!previous) return action.observedRevision >= floor || action.observedRevision + 1 >= revision;
    return action.observedRevision >= previous.revision
      || Boolean(action.time && previous.time && compareActionTime(action.time, previous.time) > 0);
  });
}

export function readCarriedQuestionItems(raw: unknown, change: FieldChange, revision: number, serverMs: number): CarriedMembership[] {
  if (!object(raw) || !isAuthoredStringList(raw.items) || !proofRevision(raw.observedRevision) || raw.observedRevision > revision) return [];
  const time = raw.time === null ? null : boundedActionTime(raw.time);
  if (time === undefined || (time && (!Number.isFinite(serverMs) || time.earliestMs > serverMs + 5))) return [];
  const selected = hardQuestionListItemChanges(change.before, change.after);
  const observedRevision = raw.observedRevision;
  const predecessorOperationId = typeof raw.predecessorOperationId === 'string' ? raw.predecessorOperationId : undefined;
  return [...new Set(raw.items)].filter(item => selected.has(item)).map(item => ({ item: digest(item), time, observedRevision,
    ...(predecessorOperationId && { predecessorOperationId }) }));
}

export function nextHardQuestionListMemberships(raw: unknown, before: FieldValue, after: FieldValue, revision: number,
  previousRevision: number, operationId: string | undefined, { time, reaffirmed = [], carried = [] }: MembershipWrite) {
  const opening = words(before), saved = words(after);
  if (!opening || !saved) return;
  const previous = readMemberships(raw, previousRevision);
  const { removes, adds } = changesBetween(opening, saved);
  const earlier = new Map(previous.changes.map(entry => [entry.item, entry]));
  const changed = [...removes, ...adds].map(digest);
  const changedKeys = new Set(changed);
  const inherited = new Map(carried.map(entry => [entry.item, entry]));
  const fresh = [...changed.map(item => inherited.get(item) ?? { item, time }), ...reaffirmed.filter(entry => !changedKeys.has(entry.item))]
    .map(entry => ({ item: entry.item, time: entry.time, revision, ...(operationId && { operationId }),
      ...(earlier.get(entry.item) && (changedKeys.has(entry.item) || earlier.get(entry.item)?.returned) && { returned: true as const }) }));
  const updated = new Set(fresh.map(entry => entry.item));
  const combined = [...fresh, ...previous.changes.filter(entry => !updated.has(entry.item))];
  return { floor: Math.max(previous.floor, combined[MAX_MEMBERSHIPS]?.revision ?? 0),
    changes: combined.slice(0, MAX_MEMBERSHIPS) };
}
