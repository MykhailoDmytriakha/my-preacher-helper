export {}; // isolate module scope (mock* names are reused across service test files)

const mockDb = { app: 'client-db' };
const mockCollection = jest.fn((_db: unknown, path: string) => ({ path }));
const mockWhere = jest.fn((field: string, op: string, value: unknown) => ({ field, op, value }));
const mockQuery = jest.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints }));
const mockGetDocs = jest.fn();
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
    getDocs: mockGetDocs,
    query: mockQuery,
    updateDoc: mockUpdateDoc,
    where: mockWhere,
  }));

  return import('@/services/tag.service');
}

const tagDoc = (id: string, data: Record<string, unknown>) => ({
  id,
  data: () => data,
  ref: { id, path: `tags/${id}` },
});

describe('tag.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE;
    jest.dontMock('@/config/firebaseClientDb');
    jest.dontMock('firebase/firestore');
  });

  it('reads custom tags through the client SDK and filters structural tags', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        tagDoc('custom-1', { userId: 'u1', name: 'Custom', color: '#222', required: false }),
        tagDoc('introduction', { userId: 'u1', name: 'Introduction', color: '#fff', required: false }),
      ],
    });

    const service = await importServiceWithClientMocks();
    const result = await service.getTags('u1');

    expect(result).toEqual({
      requiredTags: [],
      customTags: [{ id: 'custom-1', userId: 'u1', name: 'Custom', color: '#222', required: false }],
    });
    expect(mockWhere).toHaveBeenCalledWith('userId', '==', 'u1');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
