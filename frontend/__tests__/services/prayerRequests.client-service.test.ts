const mockDb = { app: 'client-db' };
const mockCollection = jest.fn((_db: unknown, path: string) => ({ type: 'collection', path }));
const mockDoc = jest.fn((_db: unknown, path: string, id: string) => ({ type: 'doc', path, id }));
const mockWhere = jest.fn((field: string, op: string, value: unknown) => ({ field, op, value }));
const mockQuery = jest.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints }));
const mockGetDocs = jest.fn();
const mockGetDoc = jest.fn();
const mockSetDoc = jest.fn();
const mockAddDoc = jest.fn();
const mockUpdateDoc = jest.fn();
const mockDeleteDoc = jest.fn();
const mockGetClientDb = jest.fn(() => mockDb);

const basePrayer = {
  userId: 'user-1',
  title: 'Prayer 1',
  status: 'active' as const,
  updates: [],
  tags: [],
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-02T00:00:00.000Z',
};

function docSnap(id: string, data: Record<string, unknown>, exists = true) {
  return {
    id,
    exists: () => exists,
    data: () => data,
  };
}

async function importServiceWithClientMocks() {
  jest.resetModules();
  process.env.NEXT_PUBLIC_API_BASE = '';

  jest.doMock('@/config/firebaseClientDb', () => ({
    getClientDb: mockGetClientDb,
  }));
  jest.doMock('firebase/firestore', () => ({
    addDoc: mockAddDoc,
    collection: mockCollection,
    deleteDoc: mockDeleteDoc,
    doc: mockDoc,
    getDoc: mockGetDoc,
    getDocs: mockGetDocs,
    query: mockQuery,
    setDoc: mockSetDoc,
    updateDoc: mockUpdateDoc,
    where: mockWhere,
  }));

  return import('@/services/prayerRequests.service');
}

describe('prayerRequests.service client Firestore path', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE;
    jest.dontMock('@/services/prayerRequests.client');
    jest.dontMock('@/config/firebaseClientDb');
    jest.dontMock('firebase/firestore');
  });

  it('routes reads and client-safe writes through Firestore while create stays on the prayer API', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        docSnap('p-old', { ...basePrayer, title: 'Older', updatedAt: '2026-03-01T00:00:00.000Z' }),
        docSnap('p-new', { ...basePrayer, title: 'Newer', updatedAt: '2026-03-03T00:00:00.000Z' }),
      ],
    });
    mockGetDoc.mockResolvedValue(docSnap('p1', basePrayer));
    mockSetDoc.mockResolvedValue(undefined);
    mockUpdateDoc.mockResolvedValue(undefined);
    mockDeleteDoc.mockResolvedValue(undefined);
    mockAddDoc.mockResolvedValue({ id: 'generated-id' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...basePrayer,
        id: 'client-prayer-id',
        title: 'Created prayer',
        description: 'Needs trimming',
        tags: ['faith'],
      }),
    });

    const service = await importServiceWithClientMocks();

    const all = await service.getAllPrayerRequests('user-1');
    const detail = await service.getPrayerRequestById('p1');

    expect(all.map((prayer) => prayer.id)).toEqual(['p-new', 'p-old']);
    expect(detail?.id).toBe('p1');
    expect(mockCollection).toHaveBeenCalledWith(mockDb, 'prayerRequests');
    expect(mockWhere).toHaveBeenCalledWith('userId', '==', 'user-1');

    mockGetDoc.mockClear();
    const created = await service.createPrayerRequest({
      id: 'client-prayer-id',
      userId: 'user-1',
      title: '  Created prayer  ',
      description: '  Needs trimming  ',
      tags: ['faith'],
    });

    expect(created).toEqual(
      expect.objectContaining({
        id: 'client-prayer-id',
        userId: 'user-1',
        title: 'Created prayer',
        description: 'Needs trimming',
        status: 'active',
        updates: [],
      })
    );
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
    expect(mockAddDoc).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/prayer'),
      expect.objectContaining({ method: 'POST' })
    );

    mockGetDoc.mockResolvedValueOnce(docSnap('p1', basePrayer));
    const updated = await service.updatePrayerRequest('p1', { title: 'Updated prayer' });
    expect(updated.title).toBe('Updated prayer');
    expect(mockUpdateDoc).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: 'prayerRequests', id: 'p1' }),
      expect.objectContaining({ title: 'Updated prayer', updatedAt: expect.any(String) })
    );

    await service.deletePrayerRequest('p1');
    expect(mockDeleteDoc).toHaveBeenCalledWith(expect.objectContaining({ path: 'prayerRequests', id: 'p1' }));

    mockGetDoc.mockResolvedValueOnce(
      docSnap('p1', {
        ...basePrayer,
        updates: [{ id: 'u0', text: 'Old update', createdAt: '2026-03-01T00:00:00.000Z' }],
      })
    );
    const updatePayload = {
      updateId: 'u-replay-1',
      text: '  Fresh update  ',
      createdAt: '2026-03-03T00:00:00.000Z',
    };
    const withUpdate = await service.addPrayerUpdate('p1', updatePayload);
    expect(withUpdate.updates).toHaveLength(2);
    expect(withUpdate.updates[1]).toEqual({
      id: 'u-replay-1',
      text: 'Fresh update',
      createdAt: '2026-03-03T00:00:00.000Z',
    });
    expect(mockUpdateDoc).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: 'prayerRequests', id: 'p1' }),
      expect.objectContaining({
        updates: [
          { id: 'u0', text: 'Old update', createdAt: '2026-03-01T00:00:00.000Z' },
          { id: 'u-replay-1', text: 'Fresh update', createdAt: '2026-03-03T00:00:00.000Z' },
        ],
        updatedAt: '2026-03-03T00:00:00.000Z',
      })
    );

    mockUpdateDoc.mockClear();
    mockGetDoc.mockResolvedValueOnce(
      docSnap('p1', {
        ...basePrayer,
        updates: [{ id: 'u-replay-1', text: 'Fresh update', createdAt: '2026-03-03T00:00:00.000Z' }],
      })
    );
    const replayedUpdate = await service.addPrayerUpdate('p1', updatePayload);
    expect(replayedUpdate.updates).toHaveLength(1);
    expect(mockUpdateDoc).not.toHaveBeenCalled();

    mockGetDoc.mockResolvedValueOnce(docSnap('p1', basePrayer));
    const answered = await service.setPrayerStatus('p1', {
      status: 'answered',
      answerText: 'Yes',
      updatedAt: '2026-03-04T00:00:00.000Z',
      answeredAt: '2026-03-04T00:00:00.000Z',
    });
    expect(answered).toEqual(
      expect.objectContaining({
        id: 'p1',
        status: 'answered',
        answerText: 'Yes',
        answeredAt: '2026-03-04T00:00:00.000Z',
      })
    );
    expect(mockUpdateDoc).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: 'prayerRequests', id: 'p1' }),
      expect.objectContaining({
        status: 'answered',
        answerText: 'Yes',
        answeredAt: '2026-03-04T00:00:00.000Z',
        updatedAt: '2026-03-04T00:00:00.000Z',
      })
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
