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

  return import('@/services/groups.service');
}

const baseGroup = {
  userId: 'user-1',
  title: 'Group 1',
  status: 'draft' as const,
  templates: [],
  flow: [],
  meetingDates: [],
  createdAt: '2026-02-10T00:00:00.000Z',
  updatedAt: '2026-02-10T00:00:00.000Z',
  seriesId: null,
  seriesPosition: null,
};

const docSnap = (id: string, data: Record<string, unknown>, exists = true) => ({
  id,
  exists: () => exists,
  data: () => data,
});

describe('groups.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE;
    jest.dontMock('@/config/firebaseClientDb');
    jest.dontMock('firebase/firestore');
  });

  it('reads groups, creates groups, and performs content updates through the client SDK', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        docSnap('g-old', { ...baseGroup, title: 'Old', updatedAt: '2026-02-10T00:00:00.000Z' }),
        docSnap('g-new', { ...baseGroup, title: 'New', updatedAt: '2026-02-11T00:00:00.000Z' }),
      ],
    });
    mockGetDoc
      .mockResolvedValueOnce(docSnap('g-new', { ...baseGroup, title: 'New' }))
      .mockResolvedValueOnce(docSnap('g-new', { ...baseGroup, title: 'New' }));
    mockSetDoc.mockResolvedValueOnce(undefined);
    mockUpdateDoc.mockResolvedValueOnce(undefined);

    const service = await importServiceWithClientMocks();
    const all = await service.getAllGroups('user-1');
    const detail = await service.getGroupById('g-new');
    const created = await service.createGroup({ ...baseGroup, id: 'client-group-id' });
    const updated = await service.updateGroup('g-new', { title: 'Updated' });

    expect(all.map((group) => group.id)).toEqual(['g-new', 'g-old']);
    expect(detail?.id).toBe('g-new');
    expect(created.id).toBe('client-group-id');
    expect(updated.title).toBe('Updated');
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'groups', id: 'client-group-id' }),
      expect.objectContaining({ title: 'Group 1' })
    );
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'groups', id: 'g-new' }),
      expect.objectContaining({ title: 'Updated', updatedAt: expect.any(String) })
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('filters calendar groups through the client SDK', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        docSnap('g1', {
          ...baseGroup,
          meetingDates: [{ id: 'd1', date: '2026-02-11', createdAt: 'x' }],
        }),
        docSnap('g2', {
          ...baseGroup,
          meetingDates: [{ id: 'd2', date: '2026-03-01', createdAt: 'x' }],
        }),
      ],
    });

    const service = await importServiceWithClientMocks();
    const result = await service.fetchCalendarGroups('user-1', '2026-02-01', '2026-02-28');

    expect(result.map((group) => group.id)).toEqual(['g1']);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps series-cascade group updates and delete on server routes', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'g1', ...baseGroup, seriesId: 'series-1' }),
      })
      .mockResolvedValueOnce({ ok: true });

    const service = await importServiceWithClientMocks();
    const updated = await service.updateGroup('g1', { seriesId: 'series-1', seriesPosition: 2 });
    await service.deleteGroup('g1');

    expect(updated.seriesId).toBe('series-1');
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/api/groups/g1'),
      expect.objectContaining({ method: 'PUT' })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/groups/g1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('keeps meeting date operations on server routes', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ meetingDate: { id: 'd1', date: '2026-02-11', createdAt: 'x' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ meetingDate: { id: 'd1', date: '2026-02-12', createdAt: 'x' } }),
      })
      .mockResolvedValueOnce({ ok: true });

    const service = await importServiceWithClientMocks();
    const added = await service.addGroupMeetingDate('g1', { date: '2026-02-11' });
    const updated = await service.updateGroupMeetingDate('g1', 'd1', { date: '2026-02-12' });
    await service.deleteGroupMeetingDate('g1', 'd1');

    expect(added.id).toBe('d1');
    expect(updated.date).toBe('2026-02-12');
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/api/groups/g1/meeting-dates'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/groups/g1/meeting-dates/d1'),
      expect.objectContaining({ method: 'PUT' })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('/api/groups/g1/meeting-dates/d1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});
