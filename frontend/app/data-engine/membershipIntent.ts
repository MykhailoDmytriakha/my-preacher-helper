import { deriveSermonIdsFromItems, inferSeriesKind, normalizeSeriesItems, removeSeriesItemByRef, reorderSeriesItemsById, upsertSeriesItem } from '@/utils/seriesItems';

import { equalValues, isValidIdentifier } from './protocol';

import type { DocumentData, Json } from './types';
import type { SeriesItem } from '@/models/models';

export type MembershipRef = { type: 'sermon' | 'group'; refId: string };
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
    const before = normalizeSeriesItems(value.items as unknown as SeriesItem[] | undefined, value.sermonIds as string[] | undefined);
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
