describe('optimisticEntityStore', () => {
  const originalIndexedDb = global.indexedDB;

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.unmock('idb-keyval');

    if (originalIndexedDb === undefined) {
      Reflect.deleteProperty(global as Record<string, unknown>, 'indexedDB');
    } else {
      global.indexedDB = originalIndexedDb;
    }
  });

  it('loads and saves via idb-keyval when IndexedDB is available', async () => {
    const getMock = jest.fn().mockResolvedValue([
      {
        localId: 'local-1',
        entityId: 'thought-1',
        operation: 'update',
        status: 'pending',
        entity: { id: 'thought-1', text: 'Saved thought' },
      },
    ]);
    const setMock = jest.fn().mockResolvedValue(undefined);

    global.indexedDB = {} as IDBFactory;
    jest.doMock('idb-keyval', () => ({
      get: getMock,
      set: setMock,
    }));

    const { loadOptimisticEntityRecords, saveOptimisticEntityRecords } = await import('@/utils/optimisticEntityStore');
    const loaded = await loadOptimisticEntityRecords<{ id: string; text: string }>('thought', 'sermon-1');

    expect(getMock).toHaveBeenCalledWith('optimistic-entities:thought:sermon-1');
    expect(loaded).toEqual([
      expect.objectContaining({
        entityId: 'thought-1',
        entity: { id: 'thought-1', text: 'Saved thought' },
      }),
    ]);

    await saveOptimisticEntityRecords('thought', 'sermon-1', loaded);

    expect(setMock).toHaveBeenCalledWith('optimistic-entities:thought:sermon-1', loaded);
  });

  it('returns an empty array when IndexedDB storage contains a non-array value', async () => {
    const getMock = jest.fn().mockResolvedValue({ invalid: true });

    global.indexedDB = {} as IDBFactory;
    jest.doMock('idb-keyval', () => ({
      get: getMock,
      set: jest.fn(),
    }));

    const { loadOptimisticEntityRecords } = await import('@/utils/optimisticEntityStore');

    await expect(loadOptimisticEntityRecords('thought', 'sermon-2')).resolves.toEqual([]);
  });

  it('uses memoryStore when IndexedDB is not available', async () => {
    // Ensure indexedDB is undefined
    Reflect.deleteProperty(global as Record<string, unknown>, 'indexedDB');

    // Re-import to trigger initialization with hasIndexedDb = false
    const { loadOptimisticEntityRecords, saveOptimisticEntityRecords } = await import('@/utils/optimisticEntityStore');

    // Initially empty
    const loadedInitially = await loadOptimisticEntityRecords<{ id: string }>('thought', 'sermon-3');
    expect(loadedInitially).toEqual([]);

    // Save
    const records = [{
      localId: 'local-3',
      entityId: 'thought-3',
      entityType: 'thought' as const,
      scopeId: 'sermon-3',
      operation: 'create' as const,
      status: 'pending' as const,
      entity: { id: 'thought-3', text: 'Some text' },
      createdAt: new Date().toISOString(),
      lastAttemptAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
    }];
    await saveOptimisticEntityRecords('thought', 'sermon-3', records);

    // Load again
    const loadedAfter = await loadOptimisticEntityRecords<{ id: string }>('thought', 'sermon-3');
    expect(loadedAfter).toEqual(records);
  });
});
