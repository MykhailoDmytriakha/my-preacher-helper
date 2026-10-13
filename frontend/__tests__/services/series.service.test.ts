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
    // Counter bump rides the ordinary updateDoc path (works offline).
    increment: (n: number) => ({ __increment: n }),
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

  // Series are written only through the data engine; the list read the legacy membership sweep uses remains.
  it('reads the owner\'s series through the client SDK', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [docSnap('series-1', baseSeries)] });
    const service = await importServiceWithClientMocks();
    const all = await service.getAllSeries('user-1');
    expect(all.map((series) => series.id)).toEqual(['series-1']);
    expect(mockWhere).toHaveBeenCalledWith('userId', '==', 'user-1');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('exposes no series writer', async () => {
    const service = await importServiceWithClientMocks();
    expect(Object.keys(service).sort()).toEqual(['getAllSeries']);
  });
});
