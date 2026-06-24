export {}; // isolate module scope (mock* names are reused across service test files)

const mockDb = { app: 'client-db' };
const mockCollection = jest.fn((_db: unknown, path: string) => ({ type: 'collection', path }));
const mockDoc = jest.fn((_db: unknown, path: string, id: string) => ({ type: 'doc', path, id }));
const mockWhere = jest.fn((field: string, op: string, value: unknown) => ({ field, op, value }));
const mockQuery = jest.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints }));
const mockGetDocs = jest.fn();
const mockGetDoc = jest.fn();
const mockSetDoc = jest.fn();
const mockUpdateDoc = jest.fn();
const mockDeleteDoc = jest.fn();
const mockGetClientDb = jest.fn(() => mockDb);

const sampleStructure = {
  introduction: [{ id: 'i1', text: 'Intro point' }],
  main: [{ id: 'm1', text: 'Main point', subPoints: [{ id: 's1', text: 'Sub', position: 1000 }] }],
  conclusion: [],
};

function docSnap(id: string, data: Record<string, unknown>, exists = true) {
  return { id, exists: () => exists, data: () => data };
}

async function importServiceWithClientFlag() {
  jest.resetModules();
  process.env.NEXT_PUBLIC_USE_CLIENT_PLAN_TEMPLATES = 'true';
  process.env.NEXT_PUBLIC_API_BASE = '';

  jest.doMock('@/config/firebaseClientDb', () => ({ getClientDb: mockGetClientDb }));
  jest.doMock('firebase/firestore', () => ({
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

  return import('@/services/planTemplate.service');
}

describe('planTemplate.service client Firestore flag', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_USE_CLIENT_PLAN_TEMPLATES;
    delete process.env.NEXT_PUBLIC_API_BASE;
    jest.dontMock('@/services/planTemplates.client');
    jest.dontMock('@/config/firebaseClientDb');
    jest.dontMock('firebase/firestore');
  });

  it('reads, creates, updates and deletes through the client Firestore SDK', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        docSnap('t-b', { userId: 'user-1', name: 'Beta', structure: sampleStructure }),
        docSnap('t-a', { userId: 'user-1', name: 'Alpha', structure: sampleStructure }),
      ],
    });
    mockSetDoc.mockResolvedValue(undefined);
    mockUpdateDoc.mockResolvedValue(undefined);
    mockDeleteDoc.mockResolvedValue(undefined);

    const service = await importServiceWithClientFlag();

    // READ — sorted by name ascending
    const list = await service.getPlanTemplates('user-1');
    expect(list.map((t) => t.id)).toEqual(['t-a', 't-b']);
    expect(mockCollection).toHaveBeenCalledWith(mockDb, 'planTemplates');
    expect(mockWhere).toHaveBeenCalledWith('userId', '==', 'user-1');

    // CREATE — setDoc directly, NO getDoc pre-check (idempotent client-id create;
    // a read on a non-existent doc would be denied by the Security Rules).
    const created = await service.createPlanTemplate({
      id: 'tpl-new',
      userId: 'user-1',
      name: 'My template',
      structure: sampleStructure,
    });
    expect(created).toEqual(
      expect.objectContaining({ id: 'tpl-new', userId: 'user-1', name: 'My template' })
    );
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'planTemplates', id: 'tpl-new' }),
      expect.objectContaining({
        userId: 'user-1',
        name: 'My template',
        structure: sampleStructure,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      })
    );

    // UPDATE — updateDoc with the patch + updatedAt
    await service.updatePlanTemplate('tpl-new', { name: 'Renamed' });
    expect(mockUpdateDoc).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: 'planTemplates', id: 'tpl-new' }),
      expect.objectContaining({ name: 'Renamed', updatedAt: expect.any(String) })
    );

    // DELETE — deleteDoc by id
    await service.deletePlanTemplate('tpl-new');
    expect(mockDeleteDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'planTemplates', id: 'tpl-new' })
    );

    // No HTTP calls at all on the client path
    expect(mockFetch).not.toHaveBeenCalled();
  });

});
