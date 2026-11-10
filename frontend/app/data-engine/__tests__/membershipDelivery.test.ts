import { describeMembershipDelivery } from '../membershipDelivery';
import { UNANSWERED_SAID_AFTER_ATTEMPTS } from '../unanswered';
import type { CommitRequest } from '../commits';
import type { MembershipScopeRecord } from '../membershipScope';
import type { JournalEntry } from '../types';
const baseline = { resource: { collection: 'series', id: 'a' }, value: { userId: 'owner', title: 'a' }, metadata: null };
const request = (id: string): CommitRequest => ({ id, owner: 'owner', editorId: id, editGeneration: 1, revision: 0,
  retentionScope: 'scope', baseline, value: baseline.value, working: baseline, intended: baseline.value,
  predecessor: null, initialized: false, command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [],
  atomic: { id: 'a', participants: ['a', 'b'] } });
const record: MembershipScopeRecord = { owner: 'owner', scopeId: 'scope', kind: 'membership', version: 1, revision: 0,
  pins: [], action: null, generation: 1, phase: 'submitted', requestIds: ['a', 'b'] };
const delivery = (state: JournalEntry['state'], attempts = state === 'unknown' ? UNANSWERED_SAID_AFTER_ATTEMPTS : 1): JournalEntry => ({ state, command: { protocol: 1, owner: 'owner', operationId: 'a',
  resource: baseline.resource, generation: 'g', kind: 'delete', dependsOn: [], baseline: baseline.value }, attempts, createdAt: 1 });

it.each(['editing', 'saving', 'cancelled'] as const)('does not turn stage %s into server confirmation', phase => {
  expect(describeMembershipDelivery({ ...record, phase, requestIds: [] }, [], [])).toEqual({ phase, canDiscard: false, code: null });
});
it('requires all participant evidence and isolates both request and journal ownership', () => {
  const a = request('a'), b = request('b');
  expect(describeMembershipDelivery(record, [a], []).phase).toBe('unavailable');
  expect(describeMembershipDelivery(record, [a, { ...b, owner: 'other' }], []).phase).toBe('unavailable');
  expect(describeMembershipDelivery(record, [a, { ...b, retentionScope: 'another-scope' }], []).phase).toBe('unavailable');
  expect(describeMembershipDelivery(record, [a, b], [{ ...delivery('unknown'), command: { ...delivery('unknown').command, owner: 'other' } }]).phase).toBe('queued');
  expect(describeMembershipDelivery(record, [a, b].map(row => ({ ...row, state: 'acknowledged' })), []).phase).toBe('acknowledged');
  expect(describeMembershipDelivery(record, [a, b].map(row => ({ ...row, state: 'cancelled' })), []).phase).toBe('cancelled');
  expect(describeMembershipDelivery(record, [{ ...a, state: 'acknowledged' }, b], []).phase).toBe('queued');
});
it.each(['queued', 'sending', 'unknown', 'blocked', 'conflict', 'refused'] as const)('describes %s delivery without allowing premature discard', phase => {
  expect(describeMembershipDelivery(record, [request('a'), request('b')], [delivery(phase)])).toMatchObject({ phase, canDiscard: false });
});
// The owner, 2026-10-17: an unanswered delivery is still on its way while the engine sends it again.
it('describes an unanswered delivery as sending until its retries are spent, never discardable', () => {
  expect(describeMembershipDelivery(record, [request('a'), request('b')], [delivery('unknown', 1)])).toMatchObject({ phase: 'sending', canDiscard: false });
  expect(describeMembershipDelivery(record, [request('a'), request('b')], [delivery('unknown', UNANSWERED_SAID_AFTER_ATTEMPTS)])).toMatchObject({ phase: 'unknown', canDiscard: false });
});
it('permits proven failure only when the entire dependent chain has no unknown delivery', () => {
  const failed = ['a', 'b'].map(id => ({ ...request(id), state: 'refused' as const, result: { kind: 'refused' as const, operationId: id, code: 'target-deleted' } }));
  expect(describeMembershipDelivery(record, failed, [])).toMatchObject({ phase: 'refused', canDiscard: true, code: 'target-deleted' });
  const later = { ...request('later'), atomic: undefined, predecessor: 'a', command: { ...delivery('unknown').command, operationId: 'later' } };
  expect(describeMembershipDelivery(record, [...failed, later], [])).toMatchObject({ phase: 'refused', canDiscard: false });
  expect(describeMembershipDelivery(record, [...failed, { ...later, command: null }], [])).toMatchObject({ canDiscard: true });
});

it('presents both actual orders from a recoverable reorder without granting a dependent choice', () => {
  const row = (id: string, position: number) => ({ id, refId: id, type: 'sermon' as const, position });
  const proposed = [row('b', 1), row('a', 2)];
  const stored = [row('a', 1), row('b', 2)];
  const scope: MembershipScopeRecord = { ...record, requestIds: ['a'], action: { kind: 'reorder', seriesId: 'a', itemIds: ['b', 'a'] } };
  const snapshot = { ...baseline, value: { ...baseline.value, items: stored },
    metadata: { protocol: 1 as const, generation: 'series-generation', revision: 3, deleted: false } };
  const answered: CommitRequest = { ...request('a'), atomic: undefined, state: 'conflict', value: { ...baseline.value, items: proposed },
    result: { kind: 'conflict', operationId: 'a', snapshot, conflicts: [{ path: ['items'], base: { exists: true, value: stored },
      mine: { exists: true, value: proposed }, theirs: { exists: true, value: stored } }] } };
  const reorderComparison = { seriesId: 'a', generation: 'series-generation', revision: 3, proposed, stored };
  expect(describeMembershipDelivery(scope, [answered], [])).toMatchObject({ reorderComparison, canChooseReorder: true });
  const later = { ...request('later'), atomic: undefined, predecessor: answered.id };
  expect(describeMembershipDelivery(scope, [answered, later], [])).toMatchObject({ reorderComparison, canChooseReorder: false });
  expect(describeMembershipDelivery(scope, [{ ...answered, owner: 'other' }], [])).not.toHaveProperty('reorderComparison');
});
