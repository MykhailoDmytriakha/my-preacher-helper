import { StudiesRepository } from '@/api/repositories/studies.repository';

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    arrayUnion: jest.fn(),
    arrayRemove: jest.fn(),
  },
}));

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
    batch: jest.fn(),
    runTransaction: jest.fn(),
  },
}));

const { adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminDb: {
    collection: jest.Mock;
    batch: jest.Mock;
    runTransaction: jest.Mock;
  };
};

const { FieldValue } = jest.requireMock('firebase-admin/firestore') as {
  FieldValue: {
    arrayUnion: jest.Mock;
    arrayRemove: jest.Mock;
  };
};

type MockDocRef = {
  id: string;
  get: jest.Mock;
  set: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

type MockBatch = {
  update: jest.Mock;
  commit: jest.Mock;
};

const snapshotFromDocs = (docs: any[]) => ({
  docs,
  empty: docs.length === 0,
  forEach: (callback: (doc: any) => void) => docs.forEach(callback),
});

const guardTransactionReadOrder = (transaction: any) => {
  let hasWritten = false;
  const guardWrite = (method: 'set' | 'update' | 'delete') => (...args: any[]) => {
    hasWritten = true;
    return transaction[method](...args);
  };

  return {
    ...transaction,
    get: (...args: any[]) => {
      if (hasWritten) {
        throw new Error('Firestore transactions require all reads to be executed before all writes');
      }
      return transaction.get(...args);
    },
    ...(transaction.set && { set: guardWrite('set') }),
    ...(transaction.update && { update: guardWrite('update') }),
    ...(transaction.delete && { delete: guardWrite('delete') }),
  };
};

describe('StudiesRepository', () => {
  let repository: StudiesRepository;
  let materialWhereGet: jest.Mock;
  let materialAdd: jest.Mock;
  let noteDocRefs: Map<string, MockDocRef>;
  let materialDocRefs: Map<string, MockDocRef>;
  let createdBatches: MockBatch[];

  const createDocRef = (id: string): MockDocRef => ({
    id,
    get: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  });

  const getNoteRef = (id: string): MockDocRef => {
    if (!noteDocRefs.has(id)) {
      noteDocRefs.set(id, createDocRef(id));
    }
    return noteDocRefs.get(id)!;
  };

  const getMaterialRef = (id: string): MockDocRef => {
    if (!materialDocRefs.has(id)) {
      materialDocRefs.set(id, createDocRef(id));
    }
    return materialDocRefs.get(id)!;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new StudiesRepository();
    materialWhereGet = jest.fn();
    materialAdd = jest.fn();
    noteDocRefs = new Map();
    materialDocRefs = new Map();
    createdBatches = [];

    FieldValue.arrayUnion.mockImplementation((value: string) => ({ __op: 'arrayUnion', value }));
    FieldValue.arrayRemove.mockImplementation((value: string) => ({ __op: 'arrayRemove', value }));

    adminDb.batch.mockImplementation(() => {
      const batch = {
        update: jest.fn(),
        commit: jest.fn().mockResolvedValue(undefined),
      };
      createdBatches.push(batch);
      return batch;
    });

    adminDb.runTransaction.mockImplementation(async (callback: (transaction: any) => Promise<unknown>) => callback(guardTransactionReadOrder({
      get: (ref: MockDocRef) => ref.get(),
      set: (ref: MockDocRef, ...args: unknown[]) => ref.set(...args),
      update: (ref: MockDocRef, ...args: unknown[]) => ref.update(...args),
    })));

    adminDb.collection.mockImplementation((name: string) => {
      if (name === 'studyNotes') {
        return {
          doc: jest.fn().mockImplementation((id: string) => getNoteRef(id)),
        };
      }

      if (name === 'studyMaterials') {
        return {
          where: jest.fn().mockImplementation(() => ({ get: materialWhereGet })),
          doc: jest.fn().mockImplementation((id: string) => getMaterialRef(id)),
          add: materialAdd,
        };
      }

      throw new Error(`Unexpected collection: ${name}`);
    });
  });

  it('returns null when note does not exist', async () => {
    getNoteRef('missing').get.mockResolvedValue({ exists: false });

    await expect(repository.getNote('missing')).resolves.toBeNull();
  });

  it('returns a normalized note when it exists', async () => {
    getNoteRef('note-1').get.mockResolvedValue({
      exists: true,
      id: 'note-1',
      data: () => ({
        userId: 'user-1',
        content: 'Content',
        scriptureRefs: [{ book: 'Romans', chapter: 8, verse: 28 }],
        tags: ['hope'],
        createdAt: '2024-01-03T00:00:00.000Z',
        updatedAt: '2024-01-03T00:00:00.000Z',
      }),
    });

    await expect(repository.getNote('note-1')).resolves.toEqual(
      expect.objectContaining({
        id: 'note-1',
        materialIds: [],
        isDraft: false,
      })
    );
  });

  it("atomically removes the note id without clobbering a concurrently added note id", async () => {
    const liveNoteIds = ['note-1', 'note-2'];
    const materialRef = { id: 'mat-1' };
    materialWhereGet.mockResolvedValue(
      snapshotFromDocs([
        {
          ref: materialRef,
          data: () => ({ userId: 'user-1', noteIds: [...liveNoteIds] }),
        },
      ])
    );
    adminDb.batch.mockImplementationOnce(() => {
      const stagedUpdates: Array<{ data: { noteIds: { __op: string; value: string } } }> = [];
      const batch = {
        update: jest.fn((_ref, data) => stagedUpdates.push({ data })),
        commit: jest.fn(async () => {
          // The query has already read noteIds. Another writer appends before this commit.
          liveNoteIds.push('note-concurrent');
          stagedUpdates.forEach(({ data }) => {
            if (data.noteIds.__op === 'arrayRemove') {
              const next = liveNoteIds.filter((id) => id !== data.noteIds.value);
              liveNoteIds.splice(0, liveNoteIds.length, ...next);
            }
          });
        }),
      };
      createdBatches.push(batch);
      return batch;
    });

    await repository.deleteNote('note-2', 'user-1');

    expect(createdBatches).toHaveLength(1);
    expect(createdBatches[0].update).toHaveBeenCalledWith(materialRef, {
      noteIds: { __op: 'arrayRemove', value: 'note-2' },
    });
    expect(liveNoteIds).toEqual(['note-1', 'note-concurrent']);
    expect(createdBatches[0].commit).toHaveBeenCalledTimes(1);
    expect(getNoteRef('note-2').delete).toHaveBeenCalledTimes(1);
  });

  it('never mutates a foreign-owned material when the owner deletes a note', async () => {
    materialWhereGet.mockResolvedValue(
      snapshotFromDocs([
        { ref: { id: 'mine' }, data: () => ({ userId: 'user-1', noteIds: ['note-2'] }) },
        { ref: { id: 'foreign' }, data: () => ({ userId: 'attacker', noteIds: ['note-2'] }) },
      ])
    );

    await repository.deleteNote('note-2', 'user-1');

    // Only the owner's material is cleaned; a foreign-owned material is left untouched.
    expect(createdBatches[0].update).toHaveBeenCalledTimes(1);
    expect(createdBatches[0].update).toHaveBeenCalledWith(
      { id: 'mine' },
      { noteIds: { __op: 'arrayRemove', value: 'note-2' } }
    );
    expect(getNoteRef('note-2').delete).toHaveBeenCalledTimes(1);
  });

  it('deletes the note directly when no materials reference it', async () => {
    materialWhereGet.mockResolvedValue(snapshotFromDocs([]));

    await repository.deleteNote('note-3', 'user-1');

    expect(createdBatches).toHaveLength(0);
    expect(getNoteRef('note-3').delete).toHaveBeenCalledTimes(1);
  });

  it('lists materials with document ids', async () => {
    materialWhereGet.mockResolvedValue(
      snapshotFromDocs([
        {
          id: 'mat-1',
          data: () => ({
            userId: 'user-1',
            title: 'Material',
            type: 'study',
            noteIds: ['note-1'],
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          }),
        },
      ])
    );

    await expect(repository.listMaterials('user-1')).resolves.toEqual([
      expect.objectContaining({ id: 'mat-1', title: 'Material' }),
    ]);
  });

  it('returns null when material does not exist', async () => {
    getMaterialRef('missing').get.mockResolvedValue({ exists: false });

    await expect(repository.getMaterial('missing')).resolves.toBeNull();
  });

  it('creates a material with deduped note ids and syncs note references', async () => {
    const dateSpy = jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2024-02-03T12:00:00.000Z');
    materialAdd.mockResolvedValue({ id: 'mat-new' });
    getNoteRef('note-1').get.mockResolvedValue({ exists: true, id: 'note-1', data: () => ({ userId: 'user-1' }) });
    getNoteRef('note-2').get.mockResolvedValue({ exists: true, id: 'note-2', data: () => ({ userId: 'user-1' }) });

    const result = await repository.createMaterial({
      userId: 'user-1',
      title: 'Guide',
      type: 'guide',
      description: 'Desc',
      noteIds: ['note-1', 'note-1', 'note-2'],
    });

    expect(materialAdd).toHaveBeenCalledWith({
      userId: 'user-1',
      title: 'Guide',
      type: 'guide',
      description: 'Desc',
      noteIds: ['note-1', 'note-2'],
      createdAt: '2024-02-03T12:00:00.000Z',
      updatedAt: '2024-02-03T12:00:00.000Z',
    });
    expect(FieldValue.arrayUnion).toHaveBeenNthCalledWith(1, 'mat-new');
    expect(FieldValue.arrayUnion).toHaveBeenNthCalledWith(2, 'mat-new');
    expect(createdBatches).toHaveLength(1);
    expect(createdBatches[0].update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'note-1' }),
      { materialIds: { __op: 'arrayUnion', value: 'mat-new' } }
    );
    expect(createdBatches[0].update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'note-2' }),
      { materialIds: { __op: 'arrayUnion', value: 'mat-new' } }
    );
    expect(result.noteIds).toEqual(['note-1', 'note-2']);

    dateSpy.mockRestore();
  });

  it('drops note ids the owner does not own (prevents cross-user note poisoning)', async () => {
    const dateSpy = jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2024-02-03T13:00:00.000Z');
    materialAdd.mockResolvedValue({ id: 'mat-x' });
    getNoteRef('own-note').get.mockResolvedValue({ exists: true, id: 'own-note', data: () => ({ userId: 'user-1' }) });
    getNoteRef('victim-note').get.mockResolvedValue({ exists: true, id: 'victim-note', data: () => ({ userId: 'victim' }) });

    const result = await repository.createMaterial({
      userId: 'user-1',
      title: 'Attack',
      type: 'study',
      noteIds: ['own-note', 'victim-note'],
    });

    // The victim's note is filtered out: the material never references it, and only the
    // owner's own note is written to.
    expect(result.noteIds).toEqual(['own-note']);
    expect(createdBatches[0].update).toHaveBeenCalledTimes(1);
    expect(createdBatches[0].update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'own-note' }),
      { materialIds: { __op: 'arrayUnion', value: 'mat-x' } }
    );

    dateSpy.mockRestore();
  });

  it('creates a material with empty note ids without starting a batch', async () => {
    const dateSpy = jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2024-02-04T12:00:00.000Z');
    materialAdd.mockResolvedValue({ id: 'mat-empty' });

    const result = await repository.createMaterial({
      userId: 'user-1',
      title: 'Standalone',
      type: 'study',
      noteIds: [],
    });

    expect(createdBatches).toHaveLength(0);
    expect(result.noteIds).toEqual([]);

    dateSpy.mockRestore();
  });

  it('updates a material, syncs added and removed note references, and persists the merged result', async () => {
    const dateSpy = jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2024-02-05T12:00:00.000Z');
    getMaterialRef('mat-1').get.mockResolvedValue({
      exists: true,
      id: 'mat-1',
      data: () => ({
        userId: 'user-1',
        title: 'Existing material',
        type: 'study',
        noteIds: ['note-1', 'note-2'],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
    });

    getNoteRef('note-1').get.mockResolvedValue({ exists: true, id: 'note-1', data: () => ({ userId: 'user-1' }) });
    getNoteRef('note-2').get.mockResolvedValue({ exists: true, id: 'note-2', data: () => ({ userId: 'user-1' }) });
    getNoteRef('note-3').get.mockResolvedValue({ exists: true, id: 'note-3', data: () => ({ userId: 'user-1' }) });

    const result = await repository.updateMaterial('mat-1', {
      title: 'Updated material',
      noteIds: ['note-2', 'note-3', 'note-3'],
    });

    expect(createdBatches).toHaveLength(0);
    expect(FieldValue.arrayUnion).toHaveBeenCalledWith('mat-1');
    expect(FieldValue.arrayRemove).toHaveBeenCalledWith('mat-1');
    expect(getNoteRef('note-3').update).toHaveBeenCalledWith(
      { materialIds: { __op: 'arrayUnion', value: 'mat-1' } }
    );
    expect(getNoteRef('note-1').update).toHaveBeenCalledWith(
      { materialIds: { __op: 'arrayRemove', value: 'mat-1' } }
    );
    expect(getMaterialRef('mat-1').set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'mat-1',
        title: 'Updated material',
        noteIds: ['note-2', 'note-3'],
        updatedAt: '2024-02-05T12:00:00.000Z',
      }),
      { merge: true }
    );
    expect(result.noteIds).toEqual(['note-2', 'note-3']);

    dateSpy.mockRestore();
  });

  it('updates a material without note sync when noteIds are not provided', async () => {
    const dateSpy = jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2024-02-06T12:00:00.000Z');
    getMaterialRef('mat-2').get.mockResolvedValue({
      exists: true,
      id: 'mat-2',
      data: () => ({
        userId: 'user-1',
        title: 'Material',
        type: 'study',
        noteIds: ['note-1'],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
    });

    const result = await repository.updateMaterial('mat-2', { description: 'New description' });

    expect(createdBatches).toHaveLength(0);
    expect(result.noteIds).toEqual(['note-1']);
    expect(getMaterialRef('mat-2').set).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'New description' }),
      { merge: true }
    );

    dateSpy.mockRestore();
  });

  it('retries updateMaterial from the concurrent committed state without losing fields or dangling note refs', async () => {
    const materialRef = getMaterialRef('mat-race');
    const liveMaterial: any = {
      userId: 'user-1',
      title: 'Original',
      description: 'Original description',
      type: 'study',
      noteIds: ['note-1'],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const noteMaterialIds = new Map([
      ['note-1', ['mat-race']],
      ['note-2', []],
    ]);
    for (const noteId of noteMaterialIds.keys()) {
      getNoteRef(noteId).get.mockImplementation(async () => ({
        exists: true,
        id: noteId,
        data: () => ({ userId: 'user-1', materialIds: [...noteMaterialIds.get(noteId)!] }),
      }));
    }

    let attempt = 0;
    adminDb.runTransaction.mockImplementationOnce(async (callback: (transaction: any) => Promise<any>) => {
      const runAttempt = async (commit: boolean) => {
        const staged: Array<() => void> = [];
        const transaction = {
          get: jest.fn(async (ref: MockDocRef) => {
            if (ref === materialRef) {
              return { exists: true, id: 'mat-race', data: () => ({ ...liveMaterial, noteIds: [...liveMaterial.noteIds] }) };
            }
            return ref.get();
          }),
          set: jest.fn((ref: MockDocRef, value: any) => staged.push(() => Object.assign(liveMaterial, value))),
          update: jest.fn((ref: MockDocRef, value: any) => staged.push(() => {
            const ids = noteMaterialIds.get(ref.id)!;
            const op = value.materialIds;
            noteMaterialIds.set(ref.id, op.__op === 'arrayUnion'
              ? Array.from(new Set([...ids, op.value]))
              : ids.filter((id) => id !== op.value));
          })),
        };
        const result = await callback(guardTransactionReadOrder(transaction));
        if (commit) staged.forEach((write) => write());
        return result;
      };

      attempt += 1;
      await runAttempt(false);
      // A same-owner writer commits after the first read, forcing Firestore to retry.
      liveMaterial.description = 'Concurrent description';
      attempt += 1;
      return runAttempt(true);
    });

    const result = await repository.updateMaterial('mat-race', {
      title: 'Our title',
      noteIds: ['note-2'],
    });

    expect(attempt).toBe(2);
    expect(liveMaterial).toEqual(expect.objectContaining({
      title: 'Our title',
      description: 'Concurrent description',
      noteIds: ['note-2'],
    }));
    expect(noteMaterialIds.get('note-1')).toEqual([]);
    expect(noteMaterialIds.get('note-2')).toEqual(['mat-race']);
    expect(result).toEqual(expect.objectContaining({ description: 'Concurrent description', noteIds: ['note-2'] }));
  });

  it('does not leave material or note-ref writes behind when updateMaterial transaction fails', async () => {
    const materialRef = getMaterialRef('mat-atomic');
    const liveMaterial = { userId: 'user-1', title: 'Original', type: 'study', noteIds: ['note-1'] };
    getNoteRef('note-1').get.mockResolvedValue({ exists: true, id: 'note-1', data: () => ({ userId: 'user-1' }) });
    getNoteRef('note-2').get.mockResolvedValue({ exists: true, id: 'note-2', data: () => ({ userId: 'user-1' }) });
    const transactionUpdate = jest.fn();
    adminDb.runTransaction.mockImplementationOnce(async (callback: (transaction: any) => Promise<any>) => {
      await callback(guardTransactionReadOrder({
        get: (ref: MockDocRef) => ref === materialRef
          ? Promise.resolve({ exists: true, id: 'mat-atomic', data: () => ({ ...liveMaterial }) })
          : ref.get(),
        set: jest.fn(),
        update: transactionUpdate,
      }));
      throw new Error('transaction commit failed');
    });

    await expect(repository.updateMaterial('mat-atomic', { noteIds: ['note-2'] }))
      .rejects.toThrow('transaction commit failed');

    expect(liveMaterial).toEqual({ userId: 'user-1', title: 'Original', type: 'study', noteIds: ['note-1'] });
    expect(transactionUpdate).toHaveBeenCalledTimes(2);
    expect(createdBatches).toHaveLength(0);
  });

  it('throws when updating a missing material', async () => {
    getMaterialRef('missing').get.mockResolvedValue({ exists: false });

    await expect(repository.updateMaterial('missing', { title: 'Updated' })).rejects.toThrow('Study material not found');
  });

  it('deletes a material and removes note references when the material exists', async () => {
    getMaterialRef('mat-1').get.mockResolvedValue({
      exists: true,
      id: 'mat-1',
      data: () => ({
        userId: 'user-1',
        title: 'Material',
        type: 'study',
        noteIds: ['note-1', 'note-2'],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
    });

    getNoteRef('note-1').get.mockResolvedValue({ exists: true, id: 'note-1', data: () => ({ userId: 'user-1' }) });
    getNoteRef('note-2').get.mockResolvedValue({ exists: true, id: 'note-2', data: () => ({ userId: 'user-1' }) });

    await repository.deleteMaterial('mat-1');

    expect(getMaterialRef('mat-1').delete).toHaveBeenCalledTimes(1);
    expect(createdBatches).toHaveLength(1);
    expect(createdBatches[0].update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'note-1' }),
      { materialIds: { __op: 'arrayRemove', value: 'mat-1' } }
    );
    expect(createdBatches[0].update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'note-2' }),
      { materialIds: { __op: 'arrayRemove', value: 'mat-1' } }
    );
  });

  it('never writes to a foreign note when deleting a legacy material that lists one', async () => {
    getMaterialRef('mat-legacy').get.mockResolvedValue({
      exists: true,
      id: 'mat-legacy',
      data: () => ({
        userId: 'user-1',
        title: 'Legacy',
        type: 'study',
        noteIds: ['note-1', 'victim-note'],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
    });
    getNoteRef('note-1').get.mockResolvedValue({ exists: true, id: 'note-1', data: () => ({ userId: 'user-1' }) });
    getNoteRef('victim-note').get.mockResolvedValue({ exists: true, id: 'victim-note', data: () => ({ userId: 'victim' }) });

    await repository.deleteMaterial('mat-legacy');

    // Only the owner's own note ref is cleaned; the victim's note is never written to.
    expect(createdBatches[0].update).toHaveBeenCalledTimes(1);
    expect(createdBatches[0].update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'note-1' }),
      { materialIds: { __op: 'arrayRemove', value: 'mat-legacy' } }
    );
  });

  it('deletes a material without note cleanup when it is already missing', async () => {
    getMaterialRef('missing').get.mockResolvedValue({ exists: false });

    await repository.deleteMaterial('missing');

    expect(getMaterialRef('missing').delete).toHaveBeenCalledTimes(1);
    expect(createdBatches).toHaveLength(0);
  });
});
