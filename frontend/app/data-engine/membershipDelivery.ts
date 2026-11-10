import { cancellationScope, canCancelSavedIntent } from './atomicCommits';
import { equalValues } from './fieldValues';
import { membershipItems } from './membershipIntent';
import { reviewedSeriesReorder } from './seriesReorder';
import { shownDeliveryState } from './unanswered';

import type { CommitRequest } from './commits';
import type { MembershipScopeRecord } from './membershipScope';
import type { SeriesMembershipComparison } from './seriesMembershipHistory';
import type { SeriesReorderComparison } from './seriesReorder';
import type { JournalEntry } from './types';

export interface MembershipDelivery {
  phase: 'editing' | 'saving' | 'queued' | 'sending' | 'unknown' | 'blocked' | 'conflict' | 'refused' | 'acknowledged' | 'cancelled' | 'unavailable';
  canDiscard: boolean;
  code: string | null;
  comparisons?: SeriesMembershipComparison[];
  canChooseExact?: boolean;
  reorderComparison?: SeriesReorderComparison;
  canChooseReorder?: boolean;
  canReviewReorder?: boolean;
}

/** Delivery is confirmed only when every durable participant has its own proof. */
export function describeMembershipDelivery(record: MembershipScopeRecord, requests: readonly CommitRequest[], journal: readonly JournalEntry[]): MembershipDelivery {
  if (record.phase === 'submitted' && record.requestIds.some(id => !requests.some(request => request.id === id
    && request.owner === record.owner && request.retentionScope === record.scopeId))) return { phase: 'unavailable', canDiscard: false, code: null };
  const delivery = describeActionDelivery(record.owner, record.requestIds, requests, journal, record.phase);
  const action = record.action;
  if (action?.kind !== 'reorder' || delivery.phase !== 'conflict' || record.requestIds.length !== 1) return delivery;
  const request = requests.find(row => row.id === record.requestIds[0] && row.owner === record.owner && row.retentionScope === record.scopeId);
  const result = request?.result;
  if (request?.state !== 'conflict' || result?.kind !== 'conflict' || !request.value
    || request.baseline.resource.collection !== 'series' || request.baseline.resource.id !== action.seriesId
    || result.snapshot.resource.collection !== 'series' || result.snapshot.resource.id !== action.seriesId
    || result.snapshot.value?.userId !== record.owner || result.snapshot.metadata?.deleted) return delivery;
  const proposed = membershipItems(request.value);
  if (!equalValues(proposed.map(row => row.id), action.itemIds)) return delivery;
  const reorderComparison: SeriesReorderComparison = { seriesId: action.seriesId, generation: result.snapshot.metadata?.generation ?? null,
    revision: result.snapshot.metadata?.revision ?? 0, proposed, stored: membershipItems(result.snapshot.value) };
  const chain = cancellationScope(requests.filter(row => row.owner === record.owner), '', record.requestIds);
  const canChooseReorder = delivery.canDiscard && chain.every(row => record.requestIds.includes(row.id));
  const canReviewReorder = canChooseReorder && Boolean(reviewedSeriesReorder(reorderComparison.stored, proposed, action.reorder)?.trace.length);
  return { ...delivery, reorderComparison, canChooseReorder, canReviewReorder };
}

/** One delivery calculation for staged membership and one-shot atomic actions. */
export function describeActionDelivery(owner: string, requestIds: readonly string[], requests: readonly CommitRequest[], journal: readonly JournalEntry[],
  capturePhase: MembershipScopeRecord['phase'] = 'submitted'): MembershipDelivery {
  const status = (phase: MembershipDelivery['phase'], canDiscard = false, code: string | null = null): MembershipDelivery => ({ phase, canDiscard, code });
  if (capturePhase !== 'submitted') return status(capturePhase);
  const owned = requests.filter(request => request.owner === owner);
  const participants = requestIds.map(id => owned.find(request => request.id === id));
  if (participants.some(request => !request)) return status('unavailable');
  const complete = participants as CommitRequest[];
  if (complete.every(request => request.state === 'acknowledged')) return status('acknowledged');
  if (complete.every(request => request.state === 'cancelled')) return status('cancelled');
  const chain = cancellationScope(owned, '', requestIds);
  const entries = journal.filter(entry => entry.command.owner === owner);
  const operations = new Set(complete.flatMap(request => [request.atomic?.id, request.command?.operationId].filter(Boolean)));
  const deliveries = entries.filter(entry => operations.has(entry.command.operationId));
  let phase: MembershipDelivery['phase'] = 'queued';
  for (const next of ['sending', 'blocked', 'refused', 'conflict', 'unknown'] as const) {
    if (deliveries.some(entry => shownDeliveryState(entry) === next) || complete.some(request => request.state === next)) phase = next;
  }
  const refused = complete.find(request => request.result?.kind === 'refused')?.result;
  const result = status(phase, canCancelSavedIntent(chain, entries), refused?.kind === 'refused' ? refused.code : null);
  const comparisons = refused?.kind === 'refused' ? refused.seriesMembershipComparisons : undefined;
  const canChooseExact = result.canDiscard && chain.every(request => requestIds.includes(request.id));
  return comparisons?.length ? { ...result, comparisons, canChooseExact } : result;
}
