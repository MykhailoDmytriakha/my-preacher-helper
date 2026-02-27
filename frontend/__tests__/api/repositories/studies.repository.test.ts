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
  },
}));

const { adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminDb: {
    collection: jest.Mock;
    batch: jest.Mock;
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

describe('StudiesRepository', () => {
  let repository: StudiesRepository;
  let noteWhereGet: jest.Mock;
  let materialWhereGet: jest.Mock;
  let noteAdd: jest.Mock;
  let materialAdd: jest.Mock;
  let noteDocRefs: Map<string, MockDocRef>;
  let materialDocRefs: Map<string, MockDocRef>;
  let createdBatches: MockBatch[];

  const createDocRef = (id: string): MockDocRef => ({
    id,
    get: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
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
    noteWhereGet = jest.fn();
    materialWhereGet = jest.fn();
    noteAdd = jest.fn();
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

    adminDb.collection.mockImplementation((name: string) => {
      if (name === 'studyNotes') {
        return {
          where: jest.fn().mockImplementation(() => ({ get: noteWhereGet })),
          doc: jest.fn().mockImplementation((id: string) => getNoteRef(id)),
          add: noteAdd,
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

  it('lists notes and normalizes missing arrays and draft state', async () => {
    noteWhereGet.mockResolvedValue(
      snapshotFromDocs([
        {
          id: 'note-1',
          data: () => ({
            userId: 'user-1',
            content: 'Draft note',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          }),
        },
        {
          id: 'note-2',
          data: () => ({
            userId: 'user-1',
            content: 'Ready note',
            scriptureRefs: [{ book: 'John', chapter: 3, verse: 16 }],
            tags: ['faith'],
            materialIds: ['mat-1'],
            createdAt: '2024-01-02T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          }),
        },
      ])
    );

    const result = await repository.listNotes('user-1');

    expect(result).toEqual([
      expect.objectContaining({
        id: 'note-1',
        scriptureRefs: [],
        tags: [],
        materialIds: [],
        isDraft: true,
      }),
      expect.objectContaining({
        id: 'note-2',
        scriptureRefs: [{ book: 'John', chapter: 3, verse: 16 }],
        tags: ['faith'],
        materialIds: ['mat-1'],
        isDraft: false,
      }),
    ]);
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

  it('creates a note without persisting derived fields', async () => {
    const dateSpy = jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2024-02-01T12:00:00.000Z');
    noteAdd.mockResolvedValue({ id: 'note-new' });

    const result = await repository.createNote({
      userId: 'user-1',
      content: 'New note',
      scriptureRefs: [],
      tags: ['draft-tag'],
      materialIds: ['mat-1'],
      relatedSermonIds: ['sermon-1'],
      type: 'note',
      title: 'New',
    });

    expect(noteAdd).toHaveBeenCalledWith({
      userId: 'user-1',
      content: 'New note',
      scriptureRefs: [],
      tags: ['draft-tag'],
      type: 'note',
      title: 'New',
      createdAt: '2024-02-01T12:00:00.000Z',
      updatedAt: '2024-02-01T12:00:00.000Z',
    });
    expect(result).toEqual({
      userId: 'user-1',
      content: 'New note',
      scriptureRefs: [],
      tags: ['draft-tag'],
      materialIds: ['mat-1'],
      relatedSermonIds: ['sermon-1'],
      type: 'note',
      title: 'New',
      createdAt: '2024-02-01T12:00:00.000Z',
      updatedAt: '2024-02-01T12:00:00.000Z',
      id: 'note-new',
      isDraft: true,
    });

    dateSpy.mockRestore();
  });

  it('updates a note, recomputes draft status, and persists merged data', async () => {
    const dateSpy = jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2024-02-02T12:00:00.000Z');
    getNoteRef('note-1').get.mockResolvedValue({
      exists: true,
      id: 'note-1',
      data: () => ({
        userId: 'user-1',
        content: 'Existing',
        scriptureRefs: [{ book: 'John', chapter: 1, verse: 1 }],
        tags: ['old'],
        materialIds: ['mat-1'],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
    });

    const result = await repository.updateNote('note-1', { tags: [] });

    expect(getNoteRef('note-1').set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'note-1',
        tags: [],
        scriptureRefs: [{ book: 'John', chapter: 1, verse: 1 }],
        updatedAt: '2024-02-02T12:00:00.000Z',
        isDraft: true,
      }),
      { merge: true }
    );
    expect(result.isDraft).toBe(true);

    dateSpy.mockRestore();
  });

  it('throws when updating a missing note', async () => {
    getNoteRef('missing').get.mockResolvedValue({ exists: false });

    await expect(repository.updateNote('missing', { content: 'Updated' })).rejects.toThrow('Study note not found');
  });

  it('removes note references from materials before deleting the note', async () => {
    materialWhereGet.mockResolvedValue(
      snapshotFromDocs([
        {
          ref: { id: 'mat-1' },
          data: () => ({ noteIds: ['note-1', 'note-2'] }),
        },
        {
          ref: { id: 'mat-2' },
          data: () => ({ noteIds: ['note-2'] }),
        },
      ])
    );

    await repository.deleteNote('note-2');

    expect(createdBatches).toHaveLength(1);
    expect(createdBatches[0].update).toHaveBeenNthCalledWith(1, { id: 'mat-1' }, { noteIds: ['note-1'] });
    expect(createdBatches[0].update).toHaveBeenNthCalledWith(2, { id: 'mat-2' }, { noteIds: [] });
    expect(createdBatches[0].commit).toHaveBeenCalledTimes(1);
    expect(getNoteRef('note-2').delete).toHaveBeenCalledTimes(1);
  });

  it('deletes the note directly when no materials reference it', async () => {
    materialWhereGet.mockResolvedValue(snapshotFromDocs([]));

    await repository.deleteNote('note-3');

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

    const result = await repository.updateMaterial('mat-1', {
      title: 'Updated material',
      noteIds: ['note-2', 'note-3', 'note-3'],
    });

    expect(createdBatches).toHaveLength(2);
    expect(FieldValue.arrayUnion).toHaveBeenCalledWith('mat-1');
    expect(FieldValue.arrayRemove).toHaveBeenCalledWith('mat-1');
    expect(createdBatches[0].update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'note-3' }),
      { materialIds: { __op: 'arrayUnion', value: 'mat-1' } }
    );
    expect(createdBatches[1].update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'note-1' }),
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

  it('deletes a material without note cleanup when it is already missing', async () => {
    getMaterialRef('missing').get.mockResolvedValue({ exists: false });

    await repository.deleteMaterial('missing');

    expect(getMaterialRef('missing').delete).toHaveBeenCalledTimes(1);
    expect(createdBatches).toHaveLength(0);
  });
});
