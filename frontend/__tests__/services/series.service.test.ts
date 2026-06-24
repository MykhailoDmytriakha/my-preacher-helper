export {}; // isolate module scope (mock* names are reused across service test files)

const mockDb = { app: 'client-db' };
const mockCollection = jest.fn((_db: unknown, path: string) => ({ path }));
const mockDoc = jest.fn((_db: unknown, path: string, id: string) => ({ path, id }));
const mockWhere = jest.fn((field: string, op: string, value: unknown) => ({ field, op, value }));
const mockQuery = jest.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints }));
const mockGetDocs = jest.fn();
const mockGetDoc = jest.fn();
const mockSetDoc = jest.fn();
const mockAddDoc = jest.fn();
const mockUpdateDoc = jest.fn();
const mockGetClientDb = jest.fn(() => mockDb);
const mockFetch = jest.fn();

async function importServiceWithClientMocks() {
  jest.resetModules();
  process.env.NEXT_PUBLIC_API_BASE = '';

  jest.doMock('@/config/firebaseClientDb', () => ({
    getClientDb: mockGetClientDb,
  }));
  jest.doMock('firebase/firestore', () => ({
    addDoc: mockAddDoc,
    collection: mockCollection,
    doc: mockDoc,
    getDoc: mockGetDoc,
    getDocs: mockGetDocs,
    query: mockQuery,
    setDoc: mockSetDoc,
    updateDoc: mockUpdateDoc,
    where: mockWhere,
  }));

  return import('@/services/series.service');
}

const baseSeries = {
  userId: 'user-1',
  title: 'Series A',
  theme: 'Theme A',
  description: 'Description A',
  bookOrTopic: 'Book A',
  sermonIds: [],
  items: [],
  status: 'active' as const,
  color: '#FF0000',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const docSnap = (id: string, data: Record<string, unknown>, exists = true) => ({
  id,
  exists: () => exists,
  data: () => data,
});

describe('series.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE;
    jest.dontMock('@/config/firebaseClientDb');
    jest.dontMock('firebase/firestore');
  });

  it('reads, creates, and metadata-updates series through the client SDK', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        docSnap('series-a', { ...baseSeries, title: 'A' }),
        docSnap('series-b', { ...baseSeries, title: 'B', startDate: '2024-02-01T00:00:00Z' }),
      ],
    });
    mockGetDoc
      .mockResolvedValueOnce(docSnap('series-b', { ...baseSeries, title: 'B' }))
      .mockResolvedValueOnce(docSnap('series-b', { ...baseSeries, title: 'B' }));
    mockSetDoc.mockResolvedValueOnce(undefined);
    mockUpdateDoc.mockResolvedValueOnce(undefined);

    const service = await importServiceWithClientMocks();
    const all = await service.getAllSeries('user-1');
    const detail = await service.getSeriesById('series-b');
    const created = await service.createSeries({ ...baseSeries, id: 'client-series-id' });
    const updated = await service.updateSeries('series-b', { title: 'Updated', sermonIds: ['ignored'] } as any);

    expect(all.map((series) => series.id)).toEqual(['series-b', 'series-a']);
    expect(detail?.id).toBe('series-b');
    expect(created.id).toBe('client-series-id');
    expect(updated.title).toBe('Updated');
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'series', id: 'client-series-id' }),
      expect.objectContaining({ title: 'Series A' })
    );
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'series', id: 'series-b' }),
      expect.not.objectContaining({ sermonIds: ['ignored'] })
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps delete and sermon membership operations on server routes', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    const service = await importServiceWithClientMocks();
    await service.deleteSeries('series-1');
    await service.addSermonToSeries('series-1', 'sermon-1', 2);
    await service.removeSermonFromSeries('series-1', 'sermon-1');
    await service.reorderSermons('series-1', ['sermon-2', 'sermon-1']);

    expect(mockFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/series/series-1'), {
      method: 'DELETE',
    });
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/series/series-1/sermons'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('/api/series/series-1/sermons?sermonId=sermon-1'),
      { method: 'DELETE' }
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('/api/series/series-1/sermons'),
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('keeps mixed item membership operations on server routes', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    const service = await importServiceWithClientMocks();
    await service.addGroupToSeries('series-1', 'group-1', 3);
    await service.removeSeriesItem('series-1', 'group', 'group-1');
    await service.reorderSeriesItems('series-1', ['item-2', 'item-1']);

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/api/series/series-1/items'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/series/series-1/items?type=group&refId=group-1'),
      { method: 'DELETE' }
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('/api/series/series-1/items'),
      expect.objectContaining({ method: 'PUT' })
    );
  });
});
