import { pendingOutboxConflicts, pendingOutboxRecovery, replayOutbox } from '../outboxReplay.client';
import { enqueueWrite, listOutbox, markOutboxRecoveryRequired } from '../writeOutbox.client';

const mockWrite = jest.fn();
jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({ doc: jest.fn() }));
jest.mock('@/services/conflictSafeUpdate.client', () => ({ conflictSafeUpdate: (...args: unknown[]) => mockWrite(...args), isStaleWriteError: () => false }));
const original = { id: 'one', uid: 'owner', collection: 'sermons', docId: 'sermon', aggregate: 'core', patch: { title: 'unsent' }, baseRevision: 2, expectedBaseline: { title: 'original' }, status: 'pending' as const, savedAt: 1 };

describe('legacy replay terminal recovery', () => {
  beforeEach(() => { localStorage.clear(); mockWrite.mockReset(); enqueueWrite(original); });
  it.each(['data-engine-required', 'permission-denied', 'firestore/permission-denied'])('holds %s without replaying or offering normal conflict overwrite', async code => {
    mockWrite.mockRejectedValue(Object.assign(new Error('refused'), { code }));
    expect(await replayOutbox('owner')).toMatchObject({ recoveryRequired: 1, failed: 0, replayed: 0 });
    const [retained] = pendingOutboxRecovery('owner');
    expect(retained).toMatchObject({ ...original, status: code === 'data-engine-required' ? 'migration-required' : 'blocked' });
    expect(pendingOutboxConflicts('owner')).toEqual([]);
    await replayOutbox('owner');
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(pendingOutboxRecovery('other')).toEqual([]);
  });
  it('recognizes the exact HTTP boundary message but keeps ambiguous errors pending', async () => {
    mockWrite.mockRejectedValueOnce(new Error('data-engine-required'));
    await replayOutbox('owner');
    expect(listOutbox('owner')[0].status).toBe('migration-required');
    enqueueWrite(original);
    mockWrite.mockRejectedValueOnce(new Error('proxy permission-denied maybe'));
    expect(await replayOutbox('owner')).toMatchObject({ recoveryRequired: 0, failed: 1 });
    expect(listOutbox('owner')[0].status).toBe('pending');
  });
  it('reports quota failure without dropping original baseline or reporting migration success', async () => {
    const raw = localStorage.getItem('outbox:v1:one');
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    mockWrite.mockRejectedValue(Object.assign(new Error('refused'), { code: 'data-engine-required' }));
    try {
      expect(await replayOutbox('owner')).toMatchObject({ recoveryRequired: 0, failed: 1 });
      expect(localStorage.getItem('outbox:v1:one')).toBe(raw);
    } finally { spy.mockRestore(); }
  });
  it('does not replace malformed, missing or mismatched storage entries', () => {
    expect(markOutboxRecoveryRequired('missing', 'data-engine-required')).toBe(false);
    localStorage.setItem('outbox:v1:bad', '{');
    expect(markOutboxRecoveryRequired('bad', 'permission-denied')).toBe(false);
    localStorage.setItem('outbox:v1:other', JSON.stringify(original));
    expect(markOutboxRecoveryRequired('other', 'permission-denied')).toBe(false);
  });
});
