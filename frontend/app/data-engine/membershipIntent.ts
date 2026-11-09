import { deriveSermonIdsFromItems, inferSeriesKind, normalizeSeriesItems, removeSeriesItemByRef, reorderSeriesItemsById, upsertSeriesItem } from '@/utils/seriesItems';

import { equalValues, isValidIdentifier } from './protocol';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { SeriesCommandParticipant } from './domainPolicy';
import type { SeriesMembershipComparison } from './seriesMembershipHistory';
import type { DocumentData, Json } from './types';
import type { SeriesItem } from '@/models/models';

export type MembershipRef = { type: 'sermon' | 'group'; refId: string };
export type SeriesMembershipCapture = {
  time: ActionTime | null;
  observedRevision: number;
  observedCatalogVersion?: number;
  added: MembershipRef[];
  removed: MembershipRef[];
};

const memberKey = ({ type, refId }: MembershipRef) => `${type}:${refId}`;

export function captureSeriesMembership(before: DocumentData, after: DocumentData, time: ActionTime | null, observedRevision: number, observedCatalogVersion?: number): SeriesMembershipCapture {
  const opening = membershipItems(before), intended = membershipItems(after);
  const different = (members: SeriesItem[], compared: SeriesItem[]): MembershipRef[] => {
    const identities = new Set(compared.map(memberKey));
    return members.filter(member => !identities.has(memberKey(member))).map(({ type, refId }) => ({ type, refId }));
  };
  return { time, observedRevision, ...(observedCatalogVersion !== undefined && { observedCatalogVersion }),
    added: different(intended, opening), removed: different(opening, intended) };
}

const membershipItems = (value: DocumentData) => normalizeSeriesItems(
  value.items as unknown as SeriesItem[] | undefined, value.sermonIds as string[] | undefined,
);

/** A predecessor acknowledgement can have already satisfied, or displaced, this action. */
export function projectCapturedMembership(current: DocumentData, authored: DocumentData, capture: SeriesMembershipCapture): DocumentData {
  const before = membershipItems(current);
  const removed = new Set(capture.removed.map(memberKey));
  const added = new Set(capture.added.map(memberKey));
  const next = before.filter(member => !removed.has(memberKey(member)));
  const present = new Set(next.map(memberKey));
  for (const member of membershipItems(authored)) {
    const identity = memberKey(member);
    if (added.has(identity) && !present.has(identity)) next.splice(member.position - 1, 0, member);
  }
  if (equalValues(next, before)) return current;
  const positioned = next.map((item, index) => ({ ...item, position: index + 1 }));
  return { ...current, items: positioned as unknown as Json[], sermonIds: deriveSermonIdsFromItems(positioned), seriesKind: inferSeriesKind(positioned) };
}

export function seriesCommandParticipant(record: CommitRequest): SeriesCommandParticipant {
  const { working, intended, value, seriesMembership, seriesMembershipOpening, seriesMembershipPredecessor } = record;
  const opening = seriesMembershipOpening ?? record.baseline.value;
  const captured = record.sequence === 0 && seriesMembership && opening && value ? {
    membership: { ...seriesMembership, ...(seriesMembershipPredecessor && { predecessorOperationId: seriesMembershipPredecessor }) },
    opening, authored: value,
  } : undefined;
  return { confirmed: working, draft: intended, ...(captured && { captured }) };
}

export function showsSeriesMembershipComparison(values: readonly { id: string; generation: string | null; value: DocumentData }[],
  comparisons: readonly SeriesMembershipComparison[]): boolean {
  return comparisons.every(({ ref, stored }) => {
    const identity = memberKey(ref);
    const assigned = values.filter(row => membershipItems(row.value).some(item => memberKey(item) === identity));
    return stored ? assigned.length === 1 && assigned[0].id === stored.id && assigned[0].generation === stored.generation : assigned.length === 0;
  });
}

export type MembershipAction =
  | { kind: 'assign'; targetId: string; refs: MembershipRef[]; position?: number }
  | { kind: 'remove'; refs: MembershipRef[] }
  | { kind: 'reorder'; seriesId: string; itemIds: string[] };

/** Domain intent only. Opening copies belong to the engine; callers never supply ancestors. */
export function projectMembershipAction(values: ReadonlyMap<string, DocumentData>, action: MembershipAction | null): Map<string, DocumentData> {
  if (!action) return new Map(values);
  validateAction(action);
  const target = action.kind === 'assign' ? action.targetId : action.kind === 'reorder' ? action.seriesId : null;
  if (target && !values.has(target)) throw new Error('Membership target was not present when the action opened');
  return new Map([...values].map(([id, value]) => {
    const before = membershipItems(value);
    let after = before;
    if (action.kind === 'reorder') {
      if (id !== action.seriesId) return [id, value];
      if (action.itemIds.length !== before.length || new Set(action.itemIds).size !== before.length
        || action.itemIds.some(itemId => !before.some(item => item.id === itemId))) throw new Error('Reorder must name the opening membership exactly');
      after = reorderSeriesItemsById(before, action.itemIds);
    } else {
      for (const ref of action.refs) {
        after = action.kind === 'assign' && id === action.targetId
          ? upsertSeriesItem(after, { ...ref, position: action.position })
          : removeSeriesItemByRef(after, ref);
      }
    }
    // Do not normalize untouched documents into unsolicited writes.
    if (equalValues(before, after)) return [id, value];
    return [id, { ...value, items: after as unknown as Json[], sermonIds: deriveSermonIdsFromItems(after), seriesKind: inferSeriesKind(after) }];
  }));
}

function validateAction(action: MembershipAction): void {
  if (action.kind === 'reorder') {
    if (!isValidIdentifier(action.seriesId) || !Array.isArray(action.itemIds) || action.itemIds.some(id => !isValidIdentifier(id))) throw new Error('Invalid membership reorder');
    return;
  }
  if (!['assign', 'remove'].includes(action.kind) || !Array.isArray(action.refs) || !action.refs.length
    || action.refs.some(ref => !ref || !['sermon', 'group'].includes(ref.type) || !isValidIdentifier(ref.refId))
    || new Set(action.refs.map(ref => `${ref.type}:${ref.refId}`)).size !== action.refs.length) throw new Error('Invalid membership references');
  if (action.kind === 'assign' && (!isValidIdentifier(action.targetId)
    || (action.position !== undefined && (!Number.isSafeInteger(action.position) || action.position < 0)))) throw new Error('Invalid membership target');
}
