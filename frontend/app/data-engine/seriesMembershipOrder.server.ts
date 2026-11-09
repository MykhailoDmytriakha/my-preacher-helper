import { normalizeSeriesItems } from '@/utils/seriesItems';

import { boundedActionTime, compareActionTime, type ActionTime } from './actionClock';
import { captureSeriesMembership, type MembershipRef } from './membershipIntent';
import { equalValues, isValidIdentifier, mergeFields } from './protocol';

import type { SeriesHistorySelection } from './seriesMembershipHistory';
import type { ConflictDetail, DataCommand, DocumentData, ResourceRef, ResourceSnapshot } from './types';
import type { SeriesItem } from '@/models/models';

export const SERIES_MEMBERSHIP_ORDER = '_seriesMembershipOrder';
export const SERIES_MEMBERSHIP_HISTORY = '_seriesMembershipHistory';
export const SERIES_MEMBERSHIP_DELETION = 'seriesMembershipDeletionVersion';

type SeriesEdit = Extract<DataCommand, { relation: 'series-membership' }>['edits'][number];
type TimedEdit = SeriesEdit & { membership: NonNullable<SeriesEdit['membership']> };
export type MembershipLocation = SeriesHistorySelection & { revision: number };
export type SeriesMembershipHead = {
  owner: string;
  memberGeneration: string | null;
  location: MembershipLocation | null;
  time: ActionTime | null;
  operationId: string;
  catalogVersion?: number;
  applied?: true;
};
export type SeriesMembershipWrite = {
  member: ResourceRef;
  head?: SeriesMembershipHead;
  displaced?: { generation: string | null; former: MembershipLocation | null; current: MembershipLocation | null; actionTime: ActionTime; winnerTime: ActionTime };
};

type Source = TimedEdit;
type Destination = { edit: TimedEdit; item: DocumentData };
export type SeriesMembershipMove = { ref: MembershipRef; from?: Source; to?: Destination };

export const membershipKey = ({ type, refId }: Record<string, unknown>) => `${type}:${refId}`;
export const memberResource = (ref: MembershipRef): ResourceRef =>
  ({ collection: ref.type === 'sermon' ? 'sermons' : 'groups', id: ref.refId });
export const seriesLocation = (snapshot: ResourceSnapshot): MembershipLocation =>
  ({ id: snapshot.resource.id, generation: snapshot.metadata?.generation ?? null, revision: snapshot.metadata?.revision ?? 0,
    label: [snapshot.value?.title, snapshot.value?.theme].find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? '' });

const sameLocation = (left: MembershipLocation | null, right: MembershipLocation | null) =>
  left?.id === right?.id && left?.generation === right?.generation;

/** Evidence must describe the exact member delta in the original command, not any other row in the series. */
export function readSeriesMembershipMoves(edits: readonly SeriesEdit[], serverMs: number): Map<string, SeriesMembershipMove> | 'legacy-repair' | null {
  const moves = new Map<string, SeriesMembershipMove>();
  let repairsDuplicate = false;
  for (const edit of edits) {
    const membership = edit.membership;
    if (!membership || (membership.time && membership.time.earliestMs > serverMs + 5)) return null;
    const actual = captureSeriesMembership({ items: edit.beforeItems }, { items: edit.afterItems }, membership.time, membership.observedRevision);
    if (!equalValues(actual.added, membership.added) || !equalValues(actual.removed, membership.removed)) return null;
    const timed = { ...edit, membership };
    for (const ref of membership.removed) {
      const identity = membershipKey(ref), move = moves.get(identity) ?? { ref };
      if (move.from) repairsDuplicate = true;
      moves.set(identity, { ...move, from: timed });
    }
    for (const ref of membership.added) {
      const identity = membershipKey(ref), move = moves.get(identity) ?? { ref };
      const item = edit.afterItems.find(candidate => membershipKey(candidate) === identity);
      if (move.to || !item) return null;
      moves.set(identity, { ...move, to: { edit: timed, item } });
    }
  }
  // An unchanged declared destination holding a removed member identifies a
  // historical duplicate repair. It is not an orderable removal to no series.
  for (const [identity, move] of moves) {
    if (move.from && !move.to && edits.some(edit => edit !== move.from
      && edit.beforeItems.some(item => membershipKey(item) === identity)
      && edit.afterItems.some(item => membershipKey(item) === identity))) repairsDuplicate = true;
  }
  return repairsDuplicate ? 'legacy-repair' : moves;
}

function matchingHead(raw: unknown, owner: string, member: ResourceSnapshot, current: MembershipLocation | null): SeriesMembershipHead | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const head = raw as Partial<SeriesMembershipHead>;
  if (head.owner !== owner || (head.memberGeneration !== null && head.memberGeneration !== member.metadata?.generation)
    || head.location === undefined || !sameLocation(head.location, current) || typeof head.operationId !== 'string') return undefined;
  if (head.location && (!Number.isSafeInteger(head.location.revision) || head.location.revision > current!.revision)) return undefined;
  const time = head.time === null ? null : boundedActionTime(head.time);
  if (time === undefined) return undefined;
  const catalogVersion = Number.isSafeInteger(head.catalogVersion) ? head.catalogVersion : undefined;
  return { owner, memberGeneration: head.memberGeneration ?? null, location: head.location, operationId: head.operationId, time,
    ...(catalogVersion !== undefined && { catalogVersion }), ...(head.applied === true && { applied: true }) };
}

/** Use the head as a locator only when it belongs to this live member. */
export function indexedSeriesMembership(raw: unknown, owner: string, member: ResourceSnapshot): MembershipLocation | null | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { location } = raw as Partial<SeriesMembershipHead>;
  if (location !== null && (!location || !isValidIdentifier(location.id)
    || (location.generation !== null && !isValidIdentifier(location.generation))
    || !Number.isSafeInteger(location.revision) || location.revision < 0 || typeof location.label !== 'string')) return undefined;
  const head = matchingHead(raw, owner, member, location);
  // An older Clear could write a null head without checking for legacy duplicates.
  return head && (location || head.applied || head.time) ? location : undefined;
}

/** A single series tombstone records its removal without per-member writes. */
export async function reconcileDeletedSeriesMembership(raw: unknown, owner: string, current: MembershipLocation | null,
  readDeletion: (location: MembershipLocation) => Promise<number | undefined>): Promise<unknown> {
  if (current || typeof raw !== 'object' || raw === null) return raw;
  const head = raw as Partial<SeriesMembershipHead>;
  const location = head.location;
  if (head.owner !== owner || !location || !isValidIdentifier(location.id)
    || (location.generation !== null && !isValidIdentifier(location.generation))) return raw;
  const version = await readDeletion(location);
  if (version === undefined || version <= (head.catalogVersion ?? 0)) return raw;
  const { applied: _oldApplication, ...prior } = head;
  return { ...prior, location: null, time: null, catalogVersion: version };
}

export function resolveSeriesMembership(move: SeriesMembershipMove, owner: string, operationId: string,
  member: ResourceSnapshot, current: MembershipLocation | null, desired: MembershipLocation | null,
  raw: unknown, predecessors: ReadonlySet<string>): { incoming: boolean; write?: SeriesMembershipWrite } | null {
  const from = move.from;
  const capture = (from ?? move.to!.edit).membership;
  const { time, observedCatalogVersion } = capture;
  const previous = matchingHead(raw, owner, member, current);
  const previousTime = previous?.time;
  const observed = (from?.resource.id ?? null) === (current?.id ?? null);
  const sawCatalog = observedCatalogVersion !== undefined && previous?.catalogVersion !== undefined && observedCatalogVersion >= previous.catalogVersion;
  const causal = observed && (!previous || sawCatalog || (from && previous.location && from.generation === previous.location.generation
    && from.membership.observedRevision >= previous.location.revision)
    || (previous.applied && predecessors.has(previous.operationId)));
  const order = previousTime && time ? compareActionTime(time, previousTime) : 0;
  const memberRef = member.resource;
  if (!causal && !order) {
    if (!sameLocation(current, desired)) return null;
    if (!previousTime) return { incoming: false };
    const { applied: _unprovedApplication, ...sameAssignment } = previous!;
    return { incoming: false, write: { member: memberRef, head: { ...sameAssignment, time: null } } };
  }
  const incoming = Boolean(causal || order > 0);
  const displaced = !causal && time && previousTime && !sameLocation(current, desired)
    ? { generation: member.metadata?.generation ?? null, former: incoming ? current : desired, current: incoming ? desired : current,
      actionTime: incoming ? previousTime : time, winnerTime: incoming ? time : previousTime }
    : undefined;
  const head: SeriesMembershipHead | undefined = incoming ? {
    owner, memberGeneration: member.metadata?.generation ?? null, location: desired, time, operationId,
    ...(!sameLocation(current, desired) && { applied: true }),
  } : undefined;
  return { incoming, ...(head || displaced ? { write: { member: memberRef, ...(head && { head }), ...(displaced && { displaced }) } } : {}) };
}

export type SeriesMembershipPlacement = { identity: string; item: DocumentData; order: readonly DocumentData[] };
type SeriesProjection = { items: DocumentData[]; conflicts: ConflictDetail[] };
const withoutMembers = (items: readonly DocumentData[], moved: Pick<ReadonlySet<string>, 'has'>): DocumentData[] =>
  normalizeSeriesItems(items.filter(item => !moved.has(membershipKey(item))) as unknown as SeriesItem[]) as unknown as DocumentData[];

export function mergeOrderedSeriesItems(current: DocumentData[], edit: SeriesEdit | undefined, moved: Pick<ReadonlySet<string>, 'has'>,
  placements: readonly SeriesMembershipPlacement[]): SeriesProjection {
  const stored = withoutMembers(current, moved);
  const merged = edit && mergeFields({ exists: true, value: withoutMembers(edit.beforeItems, moved) },
    { exists: true, value: withoutMembers(edit.afterItems, moved) }, { exists: true, value: stored }, ['items']);
  if (merged?.conflicts.length) return { items: current, conflicts: merged.conflicts };
  const items = [...(merged ? merged.value.value as DocumentData[] : stored)];
  for (const placement of placements) {
    const index = placement.order.findIndex(item => membershipKey(item) === placement.identity);
    const following = new Set(placement.order.slice(index + 1).map(membershipKey));
    const insertBefore = items.findIndex(item => following.has(membershipKey(item)));
    items.splice(insertBefore === -1 ? items.length : insertBefore, 0, placement.item);
  }
  return { items: items.map((item, index) => ({ ...item, position: index + 1 })), conflicts: [] };
}
