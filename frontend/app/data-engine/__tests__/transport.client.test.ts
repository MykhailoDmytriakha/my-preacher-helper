import { requestOwnerJson } from '@/services/ownerHttpTransport.client';
import { resolveOwnerUid } from '@/utils/queryKeys';
import { createHttpEngineTransport } from '../transport.client';
import type { DataCommand, ResourceSnapshot } from '../types';
jest.mock('@/services/ownerHttpTransport.client', () => ({ requestOwnerJson: jest.fn() }));
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: jest.fn(() => 'owner') }));
const command: DataCommand = { protocol: 1, operationId: 'op', owner: 'owner', resource: { collection: 'studies', id: 'one' }, generation: null, dependsOn: [], kind: 'create', value: { text: 'mine' } };
const snapshot: ResourceSnapshot = { resource: command.resource, value: { text: 'mine' }, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } };
describe('HTTP engine transport', () => {
  it('preserves the original committed metadata when a replay snapshot is newer', async () => {
    const committed = { ...snapshot.metadata!, operationId: 'op' };
    const current = { ...snapshot, metadata: { ...committed, revision: 2, operationId: 'later' } };
    const result = { kind: 'acknowledged', operationId: 'op', snapshot: current, committed };
    jest.mocked(requestOwnerJson).mockResolvedValue({ status: 200, value: result });
    expect(await createHttpEngineTransport().send(command)).toEqual(result);
    for (const invalid of [{ ...committed, revision: 3 }, { ...committed, generation: 'other' },
      { ...committed, operationId: 'other' }, { ...committed, deleted: true }]) {
      jest.mocked(requestOwnerJson).mockResolvedValue({ status: 200, value: { ...result, committed: invalid } });
      await expect(createHttpEngineTransport().send(command)).rejects.toMatchObject({ code: 'data-loss' });
    }
  });

  it('preserves causal operation metadata and relation effects in acknowledged receipts', async () => {
    const metadata = { ...snapshot.metadata!, operationId: 'operation-1' };
    const result = { kind: 'acknowledged', operationId: 'op', snapshot: { ...snapshot, metadata }, affected: [{ resource: { collection: 'sermons', id: 'sermon' }, metadata }] };
    jest.mocked(requestOwnerJson).mockResolvedValue({ status: 200, value: result });
    expect(await createHttpEngineTransport().send(command)).toEqual(result);
    jest.mocked(requestOwnerJson).mockResolvedValue({ status: 200, value: { ...result, snapshot: { ...snapshot, metadata: { ...metadata, operationId: 'bad/id' } } } });
    await expect(createHttpEngineTransport().send(command)).rejects.toMatchObject({ code: 'data-loss' });
  });

  beforeEach(() => { jest.mocked(resolveOwnerUid).mockReturnValue('owner'); });
  it('sends authenticated commands and validates successful snapshots', async () => {
    const result = { kind: 'acknowledged', operationId: 'op', snapshot };
    jest.mocked(requestOwnerJson).mockResolvedValue({ status: 200, value: result });
    expect(await createHttpEngineTransport().send(command)).toEqual(result);
    expect(requestOwnerJson).toHaveBeenCalledWith('/api/data-engine/commands', expect.objectContaining({ method: 'POST', payload: command }));
    jest.mocked(requestOwnerJson).mockResolvedValue({ status: 200, value: snapshot });
    expect(await createHttpEngineTransport().read('owner', command.resource)).toEqual(snapshot);
    expect(requestOwnerJson).toHaveBeenLastCalledWith('/api/data-engine/documents/studies/one', expect.objectContaining({ method: 'GET', answerStatuses: [] }));
  });
  it.each([
    { kind: 'refused', operationId: 'op', code: 'denied' },
    { kind: 'blocked', operationId: 'op', dependencies: ['before'] },
    { kind: 'conflict', operationId: 'op', snapshot, conflicts: [{ path: ['text'], base: { exists: false }, mine: { exists: true, value: 'mine' }, theirs: { exists: true, value: 'remote' } }] },
    { kind: 'deleted', operationId: 'op', snapshot: { ...snapshot, value: null, metadata: { ...snapshot.metadata, deleted: true } } },
  ])('retains protocol refusal $kind', async result => {
    jest.mocked(requestOwnerJson).mockResolvedValue({ status: 409, value: result });
    expect(await createHttpEngineTransport().send(command)).toEqual(result);
  });
  it('classifies invalid or mismatched replies and preserves network error codes', async () => {
    const transport = createHttpEngineTransport();
    for (const value of [{}, { kind: 'acknowledged', operationId: 'other', snapshot }, { kind: 'acknowledged', operationId: 'op', snapshot: { ...snapshot, resource: { ...snapshot.resource, id: 'other' } } }]) {
      jest.mocked(requestOwnerJson).mockResolvedValue({ status: 200, value });
      await expect(transport.send(command)).rejects.toMatchObject({ code: 'data-loss' });
    }
    jest.mocked(requestOwnerJson).mockResolvedValue({ status: 200, value: { ...snapshot, resource: { collection: 'wrong', id: 'one' } } });
    await expect(transport.read('owner', command.resource)).rejects.toMatchObject({ code: 'data-loss' });
    jest.mocked(requestOwnerJson).mockRejectedValue(Object.assign(new Error('timeout'), { code: 'deadline-exceeded' }));
    await expect(transport.send(command)).rejects.toMatchObject({ code: 'deadline-exceeded' });
  });
  it('checks the explicit owner before request and again after reply', async () => {
    jest.mocked(resolveOwnerUid).mockReturnValue('other');
    await expect(createHttpEngineTransport().send(command)).rejects.toMatchObject({ code: 'unauthenticated' });
    jest.mocked(resolveOwnerUid).mockReturnValueOnce('owner').mockReturnValue('other');
    jest.mocked(requestOwnerJson).mockResolvedValue({ status: 200, value: snapshot });
    await expect(createHttpEngineTransport().read('owner', command.resource)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('requests owner-scoped list pages and incremental changes with encoded cursors', async () => {
    const transport = createHttpEngineTransport();
    const document = { ...snapshot, resource: { collection: 'studyNotes', id: 'c' }, value: { userId: 'owner', content: 'mine' } };
    const page = { snapshots: [document], nextCursor: 'c', version: 7 };
    jest.mocked(requestOwnerJson).mockResolvedValueOnce({ status: 200, value: page });
    expect(await transport.list('owner', 'studyNotes', { limit: 2, cursor: 'a b' })).toEqual(page);
    expect(requestOwnerJson).toHaveBeenLastCalledWith('/api/data-engine/collections/studyNotes?limit=2&cursor=a+b', expect.objectContaining({ method: 'GET', answerStatuses: [] }));
    const changes = { snapshots: [document], cursor: 7, version: 9, hasMore: true };
    jest.mocked(requestOwnerJson).mockResolvedValueOnce({ status: 200, value: changes });
    expect(await transport.changes('owner', 'studyNotes', 5, { limit: 2 })).toEqual(changes);
    expect(requestOwnerJson).toHaveBeenLastCalledWith('/api/data-engine/changes/studyNotes?after=5&limit=2', expect.objectContaining({ method: 'GET', answerStatuses: [] }));
    jest.mocked(requestOwnerJson).mockResolvedValueOnce({ status: 200, value: { snapshots: [], nextCursor: null, version: 0 } });
    await transport.list('owner', 'studyNotes');
    expect(requestOwnerJson).toHaveBeenLastCalledWith('/api/data-engine/collections/studyNotes', expect.any(Object));
    jest.mocked(requestOwnerJson).mockResolvedValueOnce({ status: 200, value: { snapshots: [], cursor: 0, version: 1, hasMore: true, resetRequired: true } });
    expect(await transport.changes('owner', 'studyNotes', 0)).toMatchObject({ resetRequired: true });
    expect(requestOwnerJson).toHaveBeenLastCalledWith('/api/data-engine/changes/studyNotes?after=0', expect.any(Object));
  });

  it('validates collection options before issuing requests', async () => {
    const transport = createHttpEngineTransport(); jest.mocked(requestOwnerJson).mockClear();
    for (const options of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { cursor: 'bad/id' }]) {
      await expect(transport.list('owner', 'studyNotes', options)).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    await expect(transport.list('owner', '_dataEngineHeads')).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(transport.changes('owner', 'studyNotes', -1)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(transport.changes('owner', 'studyNotes', Number.MAX_SAFE_INTEGER + 1)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(requestOwnerJson).not.toHaveBeenCalled();
  });

  it('rejects malformed, duplicate and cross-owner collection responses', async () => {
    const transport = createHttpEngineTransport();
    const document = { ...snapshot, resource: { collection: 'studyNotes', id: 'one' }, value: { userId: 'owner' } };
    for (const value of [
      { snapshots: [document], nextCursor: null, version: -1 },
      { snapshots: [document, document], nextCursor: null, version: 1 },
      { snapshots: [{ ...document, value: { userId: 'other' } }], nextCursor: null, version: 1 },
      { snapshots: [{ ...document, resource: { collection: 'sermons', id: 'one' } }], nextCursor: null, version: 1 },
    ]) {
      jest.mocked(requestOwnerJson).mockResolvedValueOnce({ status: 200, value });
      await expect(transport.list('owner', 'studyNotes')).rejects.toMatchObject({ code: 'data-loss' });
    }
    jest.mocked(requestOwnerJson).mockResolvedValueOnce({ status: 200, value: { snapshots: [document], cursor: 1.5, version: 2, hasMore: true } });
    await expect(transport.changes('owner', 'studyNotes', 0)).rejects.toMatchObject({ code: 'data-loss' });
  });

  it('supports owner-ID and read-only ownerId collections while retaining the owner fence after replies', async () => {
    const transport = createHttpEngineTransport();
    const user = { ...snapshot, resource: { collection: 'users', id: 'owner' }, value: { language: 'en' } };
    jest.mocked(requestOwnerJson).mockResolvedValueOnce({ status: 200, value: { snapshots: [user], nextCursor: null, version: 1 } });
    expect((await transport.list('owner', 'users')).snapshots).toEqual([user]);
    const link = { ...snapshot, resource: { collection: 'studyNoteShareLinks', id: 'link' }, value: { ownerId: 'owner' } };
    jest.mocked(requestOwnerJson).mockResolvedValueOnce({ status: 200, value: { snapshots: [link], nextCursor: null, version: 1 } });
    expect((await transport.list('owner', 'studyNoteShareLinks')).snapshots).toEqual([link]);
    jest.mocked(resolveOwnerUid).mockReturnValueOnce('owner').mockReturnValueOnce('other');
    jest.mocked(requestOwnerJson).mockResolvedValueOnce({ status: 200, value: { snapshots: [], cursor: 1, version: 1, hasMore: false } });
    await expect(transport.changes('owner', 'studyNotes', 0)).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
