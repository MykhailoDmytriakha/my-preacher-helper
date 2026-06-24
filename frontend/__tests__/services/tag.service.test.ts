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

  it('adds and updates tags through the client SDK', async () => {
    mockGetDocs
      .mockResolvedValueOnce({ empty: true, docs: [] })
      .mockResolvedValueOnce({ empty: false, docs: [tagDoc('tag-1', { userId: 'u1', name: 'Custom' })] });
    mockAddDoc.mockResolvedValueOnce({ id: 'tag-1' });
    mockUpdateDoc.mockResolvedValueOnce(undefined);

    const tag = { id: 'tag-1', userId: 'u1', name: 'Custom', color: '#123', required: false };

    const service = await importServiceWithClientMocks();
    await expect(service.addCustomTag(tag)).resolves.toEqual(tag);
    await expect(service.updateTag({ ...tag, color: '#456' })).resolves.toEqual({
      message: 'Tag updated',
      tag: { ...tag, color: '#456' },
    });

    expect(mockAddDoc).toHaveBeenCalledWith(expect.objectContaining({ path: 'tags' }), {
      userId: 'u1',
      name: 'Custom',
      color: '#123',
      required: false,
    });
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'tags/tag-1' }),
      { name: 'Custom', color: '#456' }
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects reserved client-side tag names', async () => {
    const tag = { id: '', userId: 'u1', name: 'Introduction', color: '#fff', required: false };
    const service = await importServiceWithClientMocks();
    await expect(service.addCustomTag(tag)).rejects.toThrow('Reserved tag name');
  });

  it('keeps removeCustomTag on the server cascade route', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ message: 'Tag removed', affectedThoughts: 5 }),
    });

    const service = await importServiceWithClientMocks();
    const result = await service.removeCustomTag('u1', 'Custom');

    expect(result.affectedThoughts).toBe(5);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/tags?userId=u1&tagName=Custom'),
      { method: 'DELETE' }
    );
  });
});
