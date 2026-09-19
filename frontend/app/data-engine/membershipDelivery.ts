import { cancellationScope, canCancelSavedIntent } from './atomicCommits';

import type { CommitRequest } from './commits';
import type { MembershipScopeRecord } from './membershipScope';
import type { JournalEntry } from './types';

export interface MembershipDelivery {
  phase: 'editing' | 'saving' | 'queued' | 'sending' | 'unknown' | 'blocked' | 'conflict' | 'refused' | 'acknowledged' | 'cancelled' | 'unavailable';
  canDiscard: boolean;
  code: string | null;
}

/** Delivery is confirmed only when every durable participant has its own proof. */
export function describeMembershipDelivery(record: MembershipScopeRecord, requests: readonly CommitRequest[], journal: readonly JournalEntry[]): MembershipDelivery {
  const status = (phase: MembershipDelivery['phase'], canDiscard = false, code: string | null = null): MembershipDelivery => ({ phase, canDiscard, code });
  if (record.phase !== 'submitted') return status(record.phase);
  const owned = requests.filter(request => request.owner === record.owner);
  const participants = record.requestIds.map(id => owned.find(request => request.id === id && request.retentionScope === record.scopeId));
  if (participants.some(request => !request)) return status('unavailable');
  const complete = participants as CommitRequest[];
  if (complete.every(request => request.state === 'acknowledged')) return status('acknowledged');
  if (complete.every(request => request.state === 'cancelled')) return status('cancelled');
  const chain = cancellationScope(owned, '', record.requestIds);
  const entries = journal.filter(entry => entry.command.owner === record.owner);
  const operations = new Set(complete.flatMap(request => [request.atomic?.id, request.command?.operationId].filter(Boolean)));
  const deliveries = entries.filter(entry => operations.has(entry.command.operationId));
  let phase: MembershipDelivery['phase'] = 'queued';
  for (const next of ['sending', 'blocked', 'refused', 'conflict', 'unknown'] as const) {
    if (deliveries.some(entry => entry.state === next) || complete.some(request => request.state === next)) phase = next;
  }
  const refused = complete.find(request => request.result?.kind === 'refused')?.result;
  return status(phase, canCancelSavedIntent(chain, entries), refused?.kind === 'refused' ? refused.code : null);
}
