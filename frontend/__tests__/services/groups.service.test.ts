export {}; // isolate module scope (mock* names are reused across service test files)

const mockDb = { app: 'client-db' };
const mockCollection = jest.fn((_db: unknown, path: string) => ({ path }));
const mockDoc = jest.fn((_db: unknown, path: string, id: string) => ({ path, id }));
const mockWhere = jest.fn((field: string, op: string, value: unknown) => ({ field, op, value }));
const mockQuery = jest.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints }));
const mockGetDocs = jest.fn();
const mockGetDoc = jest.fn();
const mockGetClientDb = jest.fn(() => mockDb);
async function importServiceWithClientMocks() {
  jest.resetModules();

  jest.doMock('@/config/firebaseClientDb', () => ({
    getClientDb: mockGetClientDb,
  }));
  jest.doMock('firebase/firestore', () => ({
    collection: mockCollection,
    doc: mockDoc,
    getDoc: mockGetDoc,
    getDocs: mockGetDocs,
    query: mockQuery,
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

// Groups are written only through the data engine; the two reads the legacy series hooks still use remain.
describe('groups.service reads', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads the owner\'s groups newest first and one group through the client SDK', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        docSnap('g-old', { ...baseGroup, title: 'Old', updatedAt: '2026-02-10T00:00:00.000Z' }),
        docSnap('g-new', { ...baseGroup, title: 'New', updatedAt: '2026-02-11T00:00:00.000Z' }),
      ],
    });
    // The document read for the screen belongs to whoever is signed in (jest.setup: test-user-id).
    mockGetDoc.mockResolvedValueOnce(docSnap('g-new', { ...baseGroup, userId: 'test-user-id', title: 'New' }));

    const service = await importServiceWithClientMocks();
    const all = await service.getAllGroups('user-1');
    const detail = await service.getGroupById('g-new');

    expect(all.map((group) => group.id)).toEqual(['g-new', 'g-old']);
    expect(detail?.id).toBe('g-new');
    expect(mockWhere).toHaveBeenCalledWith('userId', '==', 'user-1');
  });

  it('exposes no group writer', async () => {
    const service = await importServiceWithClientMocks();
    expect(Object.keys(service).sort()).toEqual(['getAllGroups', 'getGroupById']);
  });
});
