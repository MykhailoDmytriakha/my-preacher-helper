import { buildLocalThoughtId, loadPendingThoughts, savePendingThoughts, LOCAL_THOUGHT_PREFIX } from '@/utils/pendingThoughtsStore';

describe('pendingThoughtsStore', () => {
  const originalIndexedDb = global.indexedDB;

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.unmock('idb-keyval');
    jest.unmock('@/utils/optimisticEntityStore');

    if (originalIndexedDb === undefined) {
      Reflect.deleteProperty(global as Record<string, unknown>, 'indexedDB');
    } else {
      global.indexedDB = originalIndexedDb;
    }
  });

  it('buildLocalThoughtId uses the local prefix', () => {
    const id = buildLocalThoughtId();
    expect(id.startsWith(LOCAL_THOUGHT_PREFIX)).toBe(true);
  });

  it('saves and loads pending thoughts when IndexedDB is unavailable', async () => {
    const sermonId = 'sermon-123';
    const record = {
      localId: `${LOCAL_THOUGHT_PREFIX}test-1`,
      sermonId,
      sectionId: 'introduction' as const,
      text: 'Pending thought',
      tags: [],
      createdAt: new Date().toISOString(),
      lastAttemptAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      status: 'pending' as const,
    };

    await savePendingThoughts(sermonId, [record]);
    const loaded = await loadPendingThoughts(sermonId);
    expect(loaded).toEqual([record]);

    await savePendingThoughts(sermonId, []);
    const cleared = await loadPendingThoughts(sermonId);
    expect(cleared).toEqual([]);
  });

  it('migrates legacy IndexedDB records into the optimistic entity store', async () => {
    const legacyRecords = [
      {
        localId: 'local-legacy',
        sermonId: 'sermon-legacy',
        sectionId: 'main' as const,
        text: 'Legacy pending thought',
        tags: ['main'],
        outlinePointId: 'point-1',
        createdAt: '2024-01-01T00:00:00.000Z',
        lastAttemptAt: '2024-01-01T00:00:00.000Z',
        expiresAt: '2024-01-01T00:30:00.000Z',
        status: 'pending' as const,
        lastError: 'none',
      },
    ];
    const loadOptimisticEntityRecords = jest.fn().mockResolvedValue([]);
    const saveOptimisticEntityRecords = jest.fn().mockResolvedValue(undefined);
    const getMock = jest.fn().mockResolvedValue(legacyRecords);
    const setMock = jest.fn().mockResolvedValue(undefined);

    global.indexedDB = {} as IDBFactory;
    jest.doMock('@/utils/optimisticEntityStore', () => ({
      loadOptimisticEntityRecords,
      saveOptimisticEntityRecords,
    }));
    jest.doMock('idb-keyval', () => ({
      get: getMock,
      set: setMock,
    }));

    const { loadPendingThoughtOptimisticRecords, PENDING_THOUGHT_ENTITY_TYPE } = await import('@/utils/pendingThoughtsStore');
    const migrated = await loadPendingThoughtOptimisticRecords('sermon-legacy');

    expect(getMock).toHaveBeenCalledWith('pending-thoughts:sermon-legacy');
    expect(saveOptimisticEntityRecords).toHaveBeenCalledWith(
      PENDING_THOUGHT_ENTITY_TYPE,
      'sermon-legacy',
      [
        expect.objectContaining({
          localId: 'local-legacy',
          entityId: 'local-legacy',
          scopeId: 'sermon-legacy',
          entity: expect.objectContaining({
            id: 'local-legacy',
            sectionId: 'main',
            text: 'Legacy pending thought',
          }),
        }),
      ]
    );
    expect(setMock).toHaveBeenCalledWith('pending-thoughts:sermon-legacy', []);
    expect(migrated[0]).toEqual(
      expect.objectContaining({
        entityId: 'local-legacy',
        status: 'pending',
      })
    );
  });

  it('clears legacy IndexedDB data after saving optimistic records', async () => {
    const saveOptimisticEntityRecords = jest.fn().mockResolvedValue(undefined);
    const setMock = jest.fn().mockResolvedValue(undefined);

    global.indexedDB = {} as IDBFactory;
    jest.doMock('@/utils/optimisticEntityStore', () => ({
      loadOptimisticEntityRecords: jest.fn().mockResolvedValue([]),
      saveOptimisticEntityRecords,
    }));
    jest.doMock('idb-keyval', () => ({
      get: jest.fn(),
      set: setMock,
    }));

    const { savePendingThoughtOptimisticRecords } = await import('@/utils/pendingThoughtsStore');

    await savePendingThoughtOptimisticRecords('sermon-1', [
      {
        localId: 'local-1',
        entityType: 'thought-structure-create',
        scopeId: 'sermon-1',
        entityId: 'local-1',
        operation: 'create',
        status: 'pending',
        entity: {
          id: 'local-1',
          sectionId: 'introduction',
          text: 'Pending',
          tags: [],
        },
        createdAt: '2024-01-01T00:00:00.000Z',
        lastAttemptAt: '2024-01-01T00:00:00.000Z',
        expiresAt: '2024-01-01T00:30:00.000Z',
      },
    ]);

    expect(saveOptimisticEntityRecords).toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith('pending-thoughts:sermon-1', []);
  });
});
