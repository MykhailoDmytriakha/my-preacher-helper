import { doc, onSnapshot } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { resolveOwnerUid } from '@/utils/queryKeys';

import { createFirestoreObservationSource, normalizeFirestoreValue } from '../source.client';

jest.mock('firebase/firestore', () => ({ doc: jest.fn(() => 'document-ref'), onSnapshot: jest.fn() }));
jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: jest.fn(() => 'database') }));
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: jest.fn(() => 'owner') }));
jest.mock('@/services/ownerHttpTransport.client', () => ({ requestOwnerJson: jest.fn() }));

const resource = { collection: 'studyNotes', id: 'note' };
const metadata = { protocol: 1, generation: 'generation', revision: 1, deleted: false };
interface TestSnapshot {
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
  exists: () => boolean;
  data: () => Record<string, unknown>;
}
const event = (raw: Record<string, unknown> | undefined, fromCache = false, hasPendingWrites = false): TestSnapshot => ({
  metadata: { fromCache, hasPendingWrites }, exists: () => raw !== undefined, data: () => raw!,
});
function setup(selected = resource) {
  let receive!: (snapshot: TestSnapshot) => void;
  let fail!: () => void;
  const stop = jest.fn();
  jest.mocked(onSnapshot).mockImplementation((...args: unknown[]) => {
    receive = args[2] as typeof receive;
    fail = args[3] as typeof fail;
    return stop;
  });
  const publish = jest.fn(), error = jest.fn();
  const unsubscribe = createFirestoreObservationSource().listen('owner', selected, publish, error);
  return { receive, fail, stop, publish, error, unsubscribe };
}

describe('Firestore observation source', () => {
  beforeEach(() => { jest.clearAllMocks(); jest.mocked(resolveOwnerUid).mockReturnValue('owner'); });
  it('normalizes timestamps and nested JSON with the same ISO representation as HTTP', () => {
    const timestamp = { toDate: () => new Date('2026-09-12T12:00:00Z') };
    expect(normalizeFirestoreValue({ title: 'note', number: 2, enabled: true, nullable: null, nested: [timestamp, new Date('2020-01-01T00:00:00Z')] })).toEqual({ title: 'note', number: 2, enabled: true, nullable: null, nested: ['2026-09-12T12:00:00.000Z', '2020-01-01T00:00:00.000Z'] });
    expect(() => normalizeFirestoreValue(undefined)).toThrow('Unsupported');
    expect(() => normalizeFirestoreValue(NaN)).toThrow('Unsupported');
  });
  it('subscribes with metadata changes and separates engine metadata from document data', () => {
    const { receive, publish, error } = setup();
    receive(event({ userId: 'owner', content: 'mine', createdAt: { toDate: () => new Date('2026-01-01T00:00:00Z') }, _dataEngine: metadata }));
    expect(getClientDb).toHaveBeenCalledTimes(1);
    expect(doc).toHaveBeenCalledWith('database', 'studyNotes', 'note');
    expect(onSnapshot).toHaveBeenCalledWith('document-ref', { includeMetadataChanges: true }, expect.any(Function), expect.any(Function));
    expect(publish).toHaveBeenCalledWith({ source: 'server', snapshot: { resource, value: { userId: 'owner', content: 'mine', createdAt: '2026-01-01T00:00:00.000Z' }, metadata } });
    expect(error).not.toHaveBeenCalled();
  });
  it('publishes legacy cache data but suppresses all pending writes and cache absences', () => {
    const { receive, publish } = setup();
    receive(event({ userId: 'owner', content: 'cached' }, true));
    expect(publish).toHaveBeenCalledWith({ source: 'cache', snapshot: { resource, value: { userId: 'owner', content: 'cached' }, metadata: null } });
    publish.mockClear();
    receive(event({ userId: 'owner', content: 'unconfirmed' }, false, true));
    receive(event(undefined, true));
    receive(event({ userId: 'owner', _dataEngine: { ...metadata, deleted: true } }, true));
    expect(publish).not.toHaveBeenCalled();
    receive(event(undefined));
    expect(publish).toHaveBeenCalledWith({ source: 'server', snapshot: { resource, value: null, metadata: null } });
    receive(event({ userId: 'owner', _dataEngine: { ...metadata, deleted: true } }));
    expect(publish).toHaveBeenLastCalledWith({ source: 'server', snapshot: { resource, value: null, metadata: { ...metadata, deleted: true } } });
  });
  it.each([{ ...metadata, protocol: 2 }, { ...metadata, revision: 0 }, { ...metadata, revision: Number.MAX_SAFE_INTEGER + 1 }, { ...metadata, deleted: 'no' }, null])('rejects unsupported metadata %j', invalid => {
    const { receive, publish, error } = setup();
    receive(event({ userId: 'owner', _dataEngine: invalid }));
    expect(publish).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledTimes(1);
  });
  it('rejects documents belonging to another user and permits owner-keyed users', () => {
    const { receive, publish, error } = setup();
    receive(event({ userId: 'other', content: 'private' }));
    expect(publish).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledTimes(1);
    const users = setup({ collection: 'users', id: 'owner' });
    users.receive(event({ language: 'en' }));
    expect(users.publish).toHaveBeenCalledWith(expect.objectContaining({ snapshot: { resource: { collection: 'users', id: 'owner' }, value: { language: 'en' }, metadata: null } }));
    const wrongUser = setup({ collection: 'users', id: 'other' });
    expect(wrongUser.error).toHaveBeenCalledTimes(1);
  });
  it('uses registered ownerId for derived share links and their tombstones', () => {
    const link = setup({ collection: 'studyNoteShareLinks', id: 'link' });
    link.receive(event({ ownerId: 'other', userId: 'owner' }));
    expect(link.publish).not.toHaveBeenCalled();
    expect(link.error).toHaveBeenCalledTimes(1);
    link.receive(event({ ownerId: 'owner', _dataEngine: { ...metadata, deleted: true } }));
    expect(link.publish).toHaveBeenCalledWith(expect.objectContaining({ snapshot: expect.objectContaining({ value: null, metadata: { ...metadata, deleted: true } }) }));
  });
  it('reads a tombstone by the owner it names outside the legacy owner field', () => {
    const tombstone = { ...metadata, revision: 2, deleted: true };
    const mine = setup();
    mine.receive(event({ _dataEngineOwner: 'owner', _dataEngine: tombstone }));
    expect(mine.publish).toHaveBeenCalledWith({ snapshot: { resource, value: null, metadata: tombstone }, source: 'server' });
    const foreign = setup();
    foreign.receive(event({ _dataEngineOwner: 'someone-else', _dataEngine: tombstone }));
    expect(foreign.publish).not.toHaveBeenCalled();
    expect(foreign.error).toHaveBeenCalled();
  });

  it('fences owner changes before subscription, during decoding, and after unsubscribe', () => {
    jest.mocked(resolveOwnerUid).mockReturnValue('other');
    const skipped = setup(); skipped.unsubscribe();
    expect(onSnapshot).not.toHaveBeenCalled(); expect(skipped.error).not.toHaveBeenCalled();
    jest.mocked(resolveOwnerUid).mockReturnValue('owner');
    const live = setup();
    live.receive(event({ userId: 'owner', time: { toDate: () => { jest.mocked(resolveOwnerUid).mockReturnValue('other'); return new Date(); } } }));
    live.fail();
    expect(live.publish).not.toHaveBeenCalled(); expect(live.error).not.toHaveBeenCalled();
    jest.mocked(resolveOwnerUid).mockReturnValue('owner');
    live.unsubscribe(); live.unsubscribe(); live.receive(event({ userId: 'owner' })); live.fail();
    expect(live.stop).toHaveBeenCalledTimes(1); expect(live.publish).not.toHaveBeenCalled();
  });
  it('reports source failures and unsupported resources without fabricating snapshots', () => {
    const live = setup(); live.fail();
    expect(live.error).toHaveBeenCalledTimes(1);
    live.receive(event({ userId: 'owner', unsupported: undefined }));
    expect(live.error).toHaveBeenCalledTimes(2);
    const nested = setup({ collection: 'studyNotes', id: 'note/nested/id' });
    expect(nested.error).toHaveBeenCalledTimes(1);
    const unknown = setup({ collection: 'unknown', id: 'note' });
    expect(unknown.error).toHaveBeenCalledTimes(1); unknown.unsubscribe();
    jest.mocked(getClientDb).mockImplementationOnce(() => { throw new Error('Unavailable'); });
    const unavailable = setup();
    expect(unavailable.error).toHaveBeenCalledTimes(1); unavailable.unsubscribe();
  });
});
