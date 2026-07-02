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
  jest.doMock('firebase/firestore', () => ({
    doc: mockDoc,
    getDoc: mockGetDoc,
    updateDoc: mockUpdateDoc,
    writeBatch: mockWriteBatch,
  }));
  return import('@/services/seriesMembership.client');
}

const snap = (id: string, data: Record<string, unknown> | null) => ({
  id,
  exists: () => data !== null,
  data: () => data,
});

// item helper for fixtures
const sermonItem = (refId: string, position = 1) => ({
  id: `sermon-${refId}`,
  type: 'sermon' as const,
  refId,
  position,
});

describe('seriesMembership.client — commitSeriesBatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('MOVE is ONE atomic writeBatch and leaves the ref in EXACTLY one series (DESYNC guard)', async () => {
    // target has nothing; source currently holds s1. A move must add to target and
    // remove from source in a single batch.
    mockGetDoc.mockImplementation((ref: { id: string }) => {
      if (ref.id === 'target') return Promise.resolve(snap('target', { items: [], sermonIds: [] }));
      if (ref.id === 'source') {
        return Promise.resolve(snap('source', { items: [sermonItem('s1')], sermonIds: ['s1'] }));
      }
      return Promise.resolve(snap(ref.id, null));
    });

    const client = await importClient();
    await client.commitSeriesBatch([
      { seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 's1' }] },
      { seriesId: 'source', op: 'remove', refs: [{ type: 'sermon', refId: 's1' }] },
    ]);

    // ONE atomic batch commit (all-or-nothing).
    expect(mockWriteBatch).toHaveBeenCalledTimes(1);
    expect(batchCommit).toHaveBeenCalledTimes(1);
    expect(batchUpdate).toHaveBeenCalledTimes(2);

    // Assert "≤1 series contains s1" DIRECTLY on the written raw items (not via derive).
    const writtenBySeries = new Map<string, { items: Array<{ refId: string }> }>();
    for (const call of batchUpdate.mock.calls) {
      const ref = call[0] as { id: string };
      const payload = call[1] as { items: Array<{ refId: string }> };
      writtenBySeries.set(ref.id, payload);
    }
    const holders = [...writtenBySeries.entries()].filter(([, payload]) =>
      payload.items.some((item) => item.refId === 's1')
    );
    expect(holders).toHaveLength(1);
    expect(holders[0][0]).toBe('target');
    // recomputed sibling fields stay consistent in the SAME write
    expect(writtenBySeries.get('target')).toEqual(
      expect.objectContaining({ sermonIds: ['s1'], seriesKind: 'sermon' })
    );
    expect(writtenBySeries.get('source')?.items).toEqual([]);
  });

  it('tolerates a concurrently-deleted series doc (skips it, commits the rest)', async () => {
    mockGetDoc.mockImplementation((ref: { id: string }) => {
      if (ref.id === 'gone') return Promise.resolve(snap('gone', null));
      return Promise.resolve(snap('target', { items: [], sermonIds: [] }));
    });

    const client = await importClient();
    await client.commitSeriesBatch([
      { seriesId: 'gone', op: 'remove', refs: [{ type: 'sermon', refId: 's1' }] },
      { seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 's1' }] },
    ]);

    expect(batchUpdate).toHaveBeenCalledTimes(1); // only 'target' written; 'gone' skipped
    expect(batchCommit).toHaveBeenCalledTimes(1);
  });

  it('no-ops (no batch) when given an empty transform list', async () => {
    const client = await importClient();
    await client.commitSeriesBatch([]);
    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(batchCommit).not.toHaveBeenCalled();
  });
});
