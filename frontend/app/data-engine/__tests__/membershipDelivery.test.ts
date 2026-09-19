import { describeMembershipDelivery } from '../membershipDelivery';
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
const delivery = (state: JournalEntry['state']): JournalEntry => ({ state, command: { protocol: 1, owner: 'owner', operationId: 'a',
  resource: baseline.resource, generation: 'g', kind: 'delete', dependsOn: [], baseline: baseline.value }, attempts: 1, createdAt: 1 });

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
it('permits proven failure only when the entire dependent chain has no unknown delivery', () => {
  const failed = ['a', 'b'].map(id => ({ ...request(id), state: 'refused' as const, result: { kind: 'refused' as const, operationId: id, code: 'target-deleted' } }));
  expect(describeMembershipDelivery(record, failed, [])).toMatchObject({ phase: 'refused', canDiscard: true, code: 'target-deleted' });
  const later = { ...request('later'), atomic: undefined, predecessor: 'a', command: { ...delivery('unknown').command, operationId: 'later' } };
  expect(describeMembershipDelivery(record, [...failed, later], [])).toMatchObject({ phase: 'refused', canDiscard: false });
  expect(describeMembershipDelivery(record, [...failed, { ...later, command: null }], [])).toMatchObject({ canDiscard: true });
});
