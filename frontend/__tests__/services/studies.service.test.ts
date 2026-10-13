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

  return import('@/services/studies.service');
}

const baseNote = {
  userId: 'user-1',
  title: 'Faith note',
  content: 'Pray with faith',
  scriptureRefs: [{ book: 'Hebrews', chapter: 11, fromVerse: 1 }],
  tags: ['faith'],
  type: 'note' as const,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-02T00:00:00.000Z',
};

const docSnap = (id: string, data: Record<string, unknown>, exists = true) => ({
  id,
  exists: () => exists,
  data: () => data,
});

describe('studies.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE;
    jest.dontMock('@/config/firebaseClientDb');
    jest.dontMock('firebase/firestore');
  });

  // Study notes are written only through the data engine; the list read the sermon side uses remains.
  it('reads and filters study notes through the client SDK', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        docSnap('note-1', baseNote),
        docSnap('note-2', { ...baseNote, title: 'Other', tags: ['hope'] }),
      ],
    });

    const service = await importServiceWithClientMocks();
    const notes = await service.getStudyNotes('user-1', { tag: 'faith', q: 'pray' });

    expect(notes.map((note) => note.id)).toEqual(['note-1']);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('exposes no study note writer', async () => {
    const service = await importServiceWithClientMocks();
    expect(['createStudyNote', 'updateStudyNote', 'deleteStudyNote'].filter(name => name in service)).toEqual([]);
  });
});
