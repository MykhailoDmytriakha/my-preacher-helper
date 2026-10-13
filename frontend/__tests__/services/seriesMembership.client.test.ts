export {}; // isolate module scope

const mockDb = { app: 'client-db' };
const mockDoc = jest.fn((_db: unknown, path: string, id: string) => ({ path, id }));
const mockGetDoc = jest.fn();
const mockUpdateDoc = jest.fn();
const batchUpdate = jest.fn();
const batchCommit = jest.fn().mockResolvedValue(undefined);
const mockWriteBatch = jest.fn(() => ({ update: batchUpdate, commit: batchCommit }));
const mockGetClientDb = jest.fn(() => mockDb);

async function importClient() {
  jest.resetModules();
  jest.doMock('@/config/firebaseClientDb', () => ({ getClientDb: mockGetClientDb }));
  // The queue is per OWNER now — a shared key let one account's stuck operation
  // block another's forever, so an operation without a signed-in owner is refused.
  jest.doMock('@/services/firebaseAuth.service', () => ({ auth: { currentUser: { uid: 'u1' } } }));
  jest.doMock('firebase/firestore', () => ({
    doc: mockDoc,
    getDoc: mockGetDoc,
    updateDoc: mockUpdateDoc,
    writeBatch: mockWriteBatch,
    // Counter bump rides the ordinary write payload.
    increment: (n: number) => ({ __increment: n }),
    // ONLINE the commit runs inside one transaction: read every target, then
    // write. Mirrors the real contract closely enough to assert on the writes.
    runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
      if (mockTransactionFailure) throw mockTransactionFailure;
      const tx = {
        get: (ref: unknown) => mockGetDoc(ref),
        update: (ref: unknown, payload: unknown) => mockTxUpdate(ref, payload),
      };
      await fn(tx);
    },
  }));
  return import('@/services/seriesMembership.client');
}

const mockTxUpdate = jest.fn();
const mockTransactionFailure: unknown = null;

// Series are engine-owned (engineOwnedCollections.ts): the legacy membership batch is refused before
// any SDK work, and an operation the previous version queued stays where the recovery notice finds it.
it('holds legacy membership bytes and refuses SDK writes', async () => {
  localStorage.clear(); jest.clearAllMocks();
  const raw = JSON.stringify({ id: 'held', uid: 'u1', savedAt: 1, transform: { seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 's1' }] } });
  localStorage.setItem('membershipOutbox:v2:held', raw);
  const client = await importClient();
  await expect(client.commitSeriesBatch([{ seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 's1' }] }])).rejects.toMatchObject({ code: 'data-engine-required' });
  expect(localStorage.getItem('membershipOutbox:v2:held')).toBe(raw);
  expect(mockGetClientDb).not.toHaveBeenCalled(); expect(mockGetDoc).not.toHaveBeenCalled(); expect(batchCommit).not.toHaveBeenCalled();
});
