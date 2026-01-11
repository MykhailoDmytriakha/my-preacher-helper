import { StudyNoteShareLinksRepository } from '@/api/repositories/studyNoteShareLinks.repository';

const mockCollection = jest.fn();
const mockWhere = jest.fn();
const mockLimit = jest.fn();
const mockGet = jest.fn();
const mockAdd = jest.fn();
const mockDoc = jest.fn();
const mockSet = jest.fn();
const mockDelete = jest.fn();

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
  },
  FieldValue: {
    increment: jest.fn(),
  },
}));

const { adminDb, FieldValue } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminDb: {
    collection: jest.Mock<unknown, unknown[]>;
  };
  FieldValue: {
    increment: jest.Mock;
  };
};

const mockIncrement = FieldValue.increment as jest.Mock;

const setupFirestoreMocks = () => {
  const queryChain = {
    where: mockWhere.mockImplementation(() => queryChain),
    limit: mockLimit.mockImplementation(() => queryChain),
    get: mockGet,
  };

  mockCollection.mockReturnValue({
    where: queryChain.where,
    doc: mockDoc,
    add: mockAdd,
  });

  mockDoc.mockReturnValue({
    get: mockGet,
    set: mockSet.mockResolvedValue(undefined),
    delete: mockDelete.mockResolvedValue(undefined),
  });
};

describe('StudyNoteShareLinksRepository', () => {
  let repository: StudyNoteShareLinksRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIncrement.mockReturnValue('increment-1');
    (adminDb.collection as jest.Mock).mockImplementation(mockCollection);
    setupFirestoreMocks();
    repository = new StudyNoteShareLinksRepository();
  });

  it('lists share links by owner and normalizes defaults', async () => {
    const docs = [
      {
        id: 'link-1',
        data: () => ({
          ownerId: 'user-1',
          noteId: 'note-1',
          token: 'token-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          viewCount: 3,
        }),
      },
      {
        id: 'link-2',
        data: () => ({
          ownerId: 'user-1',
          noteId: 'note-2',
          token: 'token-2',
        }),
      },
    ];
    mockGet.mockResolvedValue({ docs });

    const result = await repository.listByOwner('user-1');

    expect(mockCollection).toHaveBeenCalledWith('studyNoteShareLinks');
    expect(mockWhere).toHaveBeenCalledWith('ownerId', '==', 'user-1');
    expect(result).toHaveLength(2);
    expect(result[0].viewCount).toBe(3);
    expect(result[1].viewCount).toBe(0);
    expect(result[1].createdAt).toBe(new Date(0).toISOString());
  });

  it('returns null when getById does not exist', async () => {
    mockGet.mockResolvedValue({ exists: false });

    const result = await repository.getById('missing');

    expect(result).toBeNull();
    expect(mockDoc).toHaveBeenCalledWith('missing');
  });

  it('returns a share link when getById exists', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      id: 'link-1',
      data: () => ({
        ownerId: 'user-1',
        noteId: 'note-1',
        token: 'token-1',
        createdAt: '2024-01-01T00:00:00.000Z',
        viewCount: 2,
      }),
    });

    const result = await repository.getById('link-1');

    expect(result).toEqual({
      id: 'link-1',
      ownerId: 'user-1',
      noteId: 'note-1',
      token: 'token-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      viewCount: 2,
    });
  });

  it('finds share link by owner and note id', async () => {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'link-1',
          data: () => ({
            ownerId: 'user-1',
            noteId: 'note-1',
            token: 'token-1',
            createdAt: '2024-01-01T00:00:00.000Z',
            viewCount: 1,
          }),
        },
      ],
    });

    const result = await repository.findByOwnerAndNoteId('user-1', 'note-1');

    expect(mockWhere).toHaveBeenNthCalledWith(1, 'ownerId', '==', 'user-1');
    expect(mockWhere).toHaveBeenNthCalledWith(2, 'noteId', '==', 'note-1');
    expect(mockLimit).toHaveBeenCalledWith(1);
    expect(result?.id).toBe('link-1');
  });

  it('returns null when findByOwnerAndNoteId is empty', async () => {
    mockGet.mockResolvedValue({ empty: true, docs: [] });

    const result = await repository.findByOwnerAndNoteId('user-1', 'note-1');

    expect(result).toBeNull();
  });

  it('finds share link by token', async () => {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'link-2',
          data: () => ({
            ownerId: 'user-2',
            noteId: 'note-2',
            token: 'token-2',
            createdAt: '2024-01-02T00:00:00.000Z',
            viewCount: 4,
          }),
        },
      ],
    });

    const result = await repository.findByToken('token-2');

    expect(mockWhere).toHaveBeenCalledWith('token', '==', 'token-2');
    expect(result?.noteId).toBe('note-2');
  });

  it('returns null when findByToken is empty', async () => {
    mockGet.mockResolvedValue({ empty: true, docs: [] });

    const result = await repository.findByToken('missing-token');

    expect(result).toBeNull();
  });

  it('creates a share link with timestamps', async () => {
    const mockDate = new Date('2024-02-02T12:00:00Z');
    const dateSpy = jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);
    mockDate.toISOString = jest.fn().mockReturnValue('2024-02-02T12:00:00.000Z');

    mockAdd.mockResolvedValue({ id: 'new-link-id' });

    const result = await repository.createLink({
      ownerId: 'user-1',
      noteId: 'note-1',
      token: 'token-1',
    });

    expect(mockAdd).toHaveBeenCalledWith({
      ownerId: 'user-1',
      noteId: 'note-1',
      token: 'token-1',
      createdAt: '2024-02-02T12:00:00.000Z',
      viewCount: 0,
    });
    expect(result).toEqual({
      id: 'new-link-id',
      ownerId: 'user-1',
      noteId: 'note-1',
      token: 'token-1',
      createdAt: '2024-02-02T12:00:00.000Z',
      viewCount: 0,
    });

    dateSpy.mockRestore();
  });

  it('increments view count with merge', async () => {
    await repository.incrementViewCount('link-1');

    expect(mockIncrement).toHaveBeenCalledWith(1);
    expect(mockSet).toHaveBeenCalledWith({ viewCount: 'increment-1' }, { merge: true });
  });

  it('deletes a share link', async () => {
    await repository.deleteLink('link-1');

    expect(mockDelete).toHaveBeenCalled();
  });
});
