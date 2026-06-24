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

  it('reads, creates, and updates study notes through the client SDK', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        docSnap('note-1', baseNote),
        docSnap('note-2', { ...baseNote, title: 'Other', tags: ['hope'] }),
      ],
    });
    mockSetDoc.mockResolvedValueOnce(undefined);
    mockGetDoc.mockResolvedValueOnce(docSnap('note-1', baseNote));
    mockUpdateDoc.mockResolvedValueOnce(undefined);

    const service = await importServiceWithClientMocks();
    const notes = await service.getStudyNotes('user-1', { tag: 'faith', q: 'pray' });
    const created = await service.createStudyNote({ ...baseNote, id: 'client-note-id' } as any);
    const updated = await service.updateStudyNote('note-1', {
      userId: 'user-1',
      title: 'Updated',
      materialIds: ['ignored-material'],
    } as any);

    expect(notes.map((note) => note.id)).toEqual(['note-1']);
    expect(created.id).toBe('client-note-id');
    expect(updated.title).toBe('Updated');
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'studyNotes', id: 'client-note-id' }),
      expect.objectContaining({ title: 'Faith note' })
    );
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'studyNotes', id: 'note-1' }),
      expect.not.objectContaining({ materialIds: ['ignored-material'] })
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps note delete and study materials on server routes', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'm1', title: 'Material' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'm1', title: 'Material' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'm1', title: 'Updated' }) })
      .mockResolvedValueOnce({ ok: true });

    const service = await importServiceWithClientMocks();
    await service.deleteStudyNote('note-1', 'user-1');
    await expect(service.getStudyMaterials('user-1')).resolves.toHaveLength(1);
    await expect(service.createStudyMaterial({ userId: 'user-1', title: 'Material' } as any)).resolves.toEqual({
      id: 'm1',
      title: 'Material',
    });
    await expect(service.updateStudyMaterial('m1', { userId: 'user-1', title: 'Updated' } as any)).resolves.toEqual({
      id: 'm1',
      title: 'Updated',
    });
    await service.deleteStudyMaterial('m1', 'user-1');

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/api/studies/notes/note-1?userId=user-1'),
      { method: 'DELETE' }
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/studies/materials?userId=user-1'),
      { cache: 'no-store' }
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('/api/studies/materials'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('/api/studies/materials/m1?userId=user-1'),
      expect.objectContaining({ method: 'PUT' })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining('/api/studies/materials/m1?userId=user-1'),
      { method: 'DELETE' }
    );
  });
});
