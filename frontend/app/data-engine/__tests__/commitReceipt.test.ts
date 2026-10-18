import { CommitReceipts } from '../commitReceipt';
import { assertCommitCapture, type CommitRequest } from '../commits';
import { DataSession } from '../session';

import type { ResourceSnapshot } from '../types';

const initial: ResourceSnapshot = { resource: { collection: 'studyNotes', id: 'note' }, value: { userId: 'owner', content: 'Original' },
  metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function setup() {
  const session = new DataSession(initial); session.edit({ ...initial.value, content: 'Submitted' });
  const captured = session.checkpoint();
  const request: CommitRequest = { id: 'request', owner: 'owner', editorId: 'editor', editGeneration: captured.editGeneration,
    baseline: initial, value: captured.draft, predecessor: null, revision: 0, initialized: false, working: initial,
    intended: captured.draft, command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [] };
  const accepted: ResourceSnapshot = { ...initial, value: captured.draft, metadata: { ...initial.metadata!, revision: 2, operationId: 'request' } };
  const ack: CommitRequest = { ...request, revision: 4, initialized: true, state: 'acknowledged', working: accepted,
    result: { kind: 'acknowledged', operationId: request.id, snapshot: accepted } };
  return { receipts: new CommitReceipts(assertCommitCapture), captured, request, accepted, ack };
}

describe('exact whole-write receipts', () => {
  it('retains an ACK delivered before capture returns, despite a later stale queued row', async () => {
    const s = setup(), saved = deferred<CommitRequest | null>();
    const capture = s.receipts.capture('owner', 'editor', s.captured, () => saved.promise);
    s.receipts.observe(s.ack); s.receipts.observe(s.request);
    saved.resolve(s.request);
    const { receipt } = await capture;
    expect(receipt.requestId).toBe('request');
    await expect(receipt.persistence).resolves.toEqual(s.accepted);
  });

  it.each([{ owner: 'other' }, { editorId: 'sibling' }, { editGeneration: 2 }])('does not accept a sibling with identity %j', async mismatch => {
    const s = setup(); const { receipt } = await s.receipts.capture('owner', 'editor', s.captured, async () => s.request);
    let accepted = false; void receipt.persistence.then(() => { accepted = true; });
    s.receipts.observe({ ...s.ack, ...mismatch, id: 'other-request', result: { ...s.ack.result!, operationId: 'other-request' } });
    await settle(); expect(accepted).toBe(false);
    s.receipts.observe(s.ack); await expect(receipt.persistence).resolves.toEqual(s.accepted);
  });

  it('waits for the complete write even if an intermediate operation is acknowledged', async () => {
    const s = setup(); const { receipt } = await s.receipts.capture('owner', 'editor', s.captured, async () => s.request);
    let accepted = false; void receipt.persistence.then(() => { accepted = true; });
    s.receipts.observe({ ...s.ack, state: 'queued', revision: 2 });
    await settle(); expect(accepted).toBe(false);
    s.receipts.observe(s.ack); await expect(receipt.persistence).resolves.toEqual(s.accepted);
  });

  it.each(['conflict', 'refused', 'cancelled'] as const)('does not accept a %s write', async state => {
    const s = setup(); const { receipt } = await s.receipts.capture('owner', 'editor', s.captured, async () => s.request);
    const outcome = receipt.persistence.then(() => 'accepted', error => error.code);
    s.receipts.observe({ ...s.request, revision: 3, state, result: state === 'refused' ? { kind: 'refused', operationId: 'request', code: 'invalid-document' } : null });
    expect(await outcome).toBe(state === 'refused' ? 'invalid-document' : state);
    s.receipts.observe(s.ack); expect(await outcome).not.toBe('accepted');
  });

  it('retires pending observation on account change without accepting the old write', async () => {
    const s = setup(); const { receipt } = await s.receipts.capture('owner', 'editor', s.captured, async () => s.request);
    const outcome = receipt.persistence.then(() => 'accepted', error => error.code);
    s.receipts.reset(); s.receipts.observe(s.ack);
    expect(await outcome).toBe('owner-changed');
  });

  it('does not accept mismatched immutable capture data', async () => {
    const s = setup(), saved = deferred<CommitRequest | null>();
    const capture = s.receipts.capture('owner', 'editor', s.captured, () => saved.promise);
    s.receipts.observe(s.ack); saved.resolve({ ...s.request, value: { ...s.request.value, content: 'Other words' } });
    const { receipt } = await capture;
    await expect(receipt.persistence).rejects.toThrow('Saved generation cannot change');
  });

  it('returns an unchanged confirmed copy only when no pending intent exists', async () => {
    const s = setup(); const checkpoint = new DataSession(initial).checkpoint();
    const { receipt } = await s.receipts.capture('owner', 'editor', checkpoint, async () => null, async () => true);
    expect(receipt).toMatchObject({ requestId: null, kind: 'unchanged' });
    await expect(receipt.persistence).resolves.toEqual(initial);
    const pending = { ...checkpoint, pending: { previous: { generation: 0, value: initial.value } } };
    const held = await s.receipts.capture('owner', 'editor', pending, async () => null);
    await expect(held.receipt.persistence).rejects.toMatchObject({ code: 'acceptance-unavailable' });
  });

  it('never turns a local capture failure into server acceptance', async () => {
    const s = setup();
    await expect(s.receipts.capture('owner', 'editor', s.captured, async () => { throw new Error('Device storage failed'); }))
      .rejects.toThrow('Device storage failed');
    s.receipts.observe(s.ack);
  });
});
