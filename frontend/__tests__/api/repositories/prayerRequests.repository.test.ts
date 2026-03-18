import { PrayerRequestsRepository } from '@/api/repositories/prayerRequests.repository';

const mockPrayerAdd = jest.fn();
const mockPrayerWhere = jest.fn();
const mockPrayerGet = jest.fn();
const mockPrayerDoc = jest.fn();
const mockPrayerUpdate = jest.fn();
const mockPrayerDelete = jest.fn();
const mockCategoryAdd = jest.fn();
const mockCategoryWhere = jest.fn();
const mockCategoryGet = jest.fn();
const mockCategoryDoc = jest.fn();
const mockCategoryDelete = jest.fn();

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
  },
}));

const { adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminDb: { collection: jest.Mock<unknown, unknown[]> };
};

const mockCollection = adminDb.collection;

const basePrayer = {
  userId: 'user-1',
  title: 'Prayer',
  description: 'Description',
  categoryId: 'cat-1',
  tags: ['faith'],
  status: 'active' as const,
  updates: [{ id: 'u1', text: 'First', createdAt: '2026-03-02T00:00:00.000Z' }],
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-02T00:00:00.000Z',
};

const setupFirestoreMocks = () => {
  mockCollection.mockImplementation((collectionName: unknown) => {
    const name = String(collectionName);
    if (name === 'prayerRequests') {
      return {
        add: mockPrayerAdd.mockResolvedValue({ id: 'new-prayer-id' }),
        where: mockPrayerWhere.mockReturnValue({ get: mockPrayerGet }),
        doc: mockPrayerDoc.mockReturnValue({
          get: mockPrayerGet,
          update: mockPrayerUpdate.mockResolvedValue(undefined),
          delete: mockPrayerDelete.mockResolvedValue(undefined),
        }),
      };
    }

    if (name === 'prayerCategories') {
      return {
        add: mockCategoryAdd.mockResolvedValue({ id: 'new-category-id' }),
        where: mockCategoryWhere.mockReturnValue({ get: mockCategoryGet }),
        doc: mockCategoryDoc.mockReturnValue({
          delete: mockCategoryDelete.mockResolvedValue(undefined),
        }),
      };
    }

    throw new Error(`Unexpected collection ${name}`);
  });
};

describe('PrayerRequestsRepository', () => {
  let repository: PrayerRequestsRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    setupFirestoreMocks();
    repository = new PrayerRequestsRepository();
  });

  it('fetches prayers by user id, hydrates defaults, and sorts by updatedAt desc', async () => {
    mockPrayerGet.mockResolvedValueOnce({
      docs: [
        { id: 'p1', data: () => ({ ...basePrayer, updatedAt: '2026-03-01T00:00:00.000Z', tags: undefined, updates: undefined, status: undefined }) },
        { id: 'p2', data: () => ({ ...basePrayer, title: 'Newer', updatedAt: '2026-03-03T00:00:00.000Z' }) },
      ],
    });

    const result = await repository.fetchByUserId('user-1');

    expect(mockPrayerWhere).toHaveBeenCalledWith('userId', '==', 'user-1');
    expect(result.map((item) => item.id)).toEqual(['p2', 'p1']);
    expect(result[1].tags).toEqual([]);
    expect(result[1].updates).toEqual([]);
    expect(result[1].status).toBe('active');
  });

  it('fetches a single prayer and returns null when missing', async () => {
    mockPrayerGet
      .mockResolvedValueOnce({
        exists: true,
        id: 'p1',
        data: () => ({ ...basePrayer }),
      })
      .mockResolvedValueOnce({
        exists: false,
        id: 'missing',
        data: () => null,
      });

    const found = await repository.fetchById('p1');
    const missing = await repository.fetchById('missing');

    expect(found?.id).toBe('p1');
    expect(missing).toBeNull();
  });

  it('creates prayers with timestamps and strips undefined fields', async () => {
    const nowSpy = jest
      .spyOn(Date.prototype, 'toISOString')
      .mockReturnValue('2026-03-05T00:00:00.000Z');

    const created = await repository.create({
      userId: 'user-1',
      title: 'New prayer',
      description: undefined,
      categoryId: undefined,
      tags: [],
      status: 'active',
      updates: [],
    });

    expect(mockCollection).toHaveBeenCalledWith('prayerRequests');
    expect(mockPrayerAdd).toHaveBeenCalledWith({
      userId: 'user-1',
      title: 'New prayer',
      tags: [],
      status: 'active',
      updates: [],
      createdAt: '2026-03-05T00:00:00.000Z',
      updatedAt: '2026-03-05T00:00:00.000Z',
    });
    expect(created.id).toBe('new-prayer-id');
    nowSpy.mockRestore();
  });

  it('updates prayers and rejects unknown ids', async () => {
    jest.spyOn(repository, 'fetchById').mockResolvedValueOnce(null);
    await expect(repository.update('missing', { title: 'x' })).rejects.toThrow('Prayer request not found');

    const nowSpy = jest
      .spyOn(Date.prototype, 'toISOString')
      .mockReturnValue('2026-03-06T00:00:00.000Z');
    jest.spyOn(repository, 'fetchById').mockResolvedValueOnce({
      id: 'p1',
      ...basePrayer,
    } as any);

    const updated = await repository.update('p1', {
      title: 'Updated prayer',
      categoryId: undefined,
    });

    expect(mockPrayerUpdate).toHaveBeenCalledWith({
      title: 'Updated prayer',
      updatedAt: '2026-03-06T00:00:00.000Z',
    });
    expect(updated.title).toBe('Updated prayer');
    nowSpy.mockRestore();
  });

  it('adds updates, deletes updates, and marks prayers answered', async () => {
    const updateSpy = jest.spyOn(repository, 'update').mockImplementation(async (id, patch) => ({
      id,
      ...basePrayer,
      ...patch,
    }) as any);

    jest.spyOn(repository, 'fetchById').mockResolvedValue({
      id: 'p1',
      ...basePrayer,
    } as any);

    const added = await repository.addUpdate('p1', 'Fresh note');
    const removed = await repository.deleteUpdate('p1', 'u1');
    const answered = await repository.setStatus('p1', 'answered', 'God answered');

    expect(updateSpy).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        updates: expect.arrayContaining([expect.objectContaining({ text: 'Fresh note' })]),
      })
    );
    expect(added.updates).toHaveLength(2);
    expect(removed.updates).toEqual([]);
    expect(answered.status).toBe('answered');
    expect(updateSpy).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        status: 'answered',
        answerText: 'God answered',
        answeredAt: expect.any(String),
      })
    );
  });

  it('uses crypto.randomUUID for new update ids when available and deletes prayers directly', async () => {
    const originalCrypto = global.crypto;
    Object.defineProperty(global, 'crypto', {
      value: { randomUUID: jest.fn().mockReturnValue('uuid-123') },
      configurable: true,
    });

    const updateSpy = jest.spyOn(repository, 'update').mockImplementation(async (id, patch) => ({
      id,
      ...basePrayer,
      ...patch,
    }) as any);

    jest.spyOn(repository, 'fetchById').mockResolvedValue({
      id: 'p1',
      ...basePrayer,
    } as any);

    try {
      const added = await repository.addUpdate('p1', 'Fresh note');
      await repository.delete('p1');

      expect(added.updates.at(-1)?.id).toBe('uuid-123');
      expect(updateSpy).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({
          updates: expect.arrayContaining([expect.objectContaining({ id: 'uuid-123' })]),
        })
      );
      expect(mockPrayerDoc).toHaveBeenCalledWith('p1');
      expect(mockPrayerDelete).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(global, 'crypto', {
        value: originalCrypto,
        configurable: true,
      });
    }
  });

  it('handles prayer categories end to end', async () => {
    mockCategoryGet.mockResolvedValueOnce({
      docs: [
        { id: 'c2', data: () => ({ userId: 'user-1', name: 'Work', createdAt: 'x' }) },
        { id: 'c1', data: () => ({ userId: 'user-1', name: 'Family', createdAt: 'x' }) },
      ],
    });

    const categories = await repository.fetchCategoriesByUserId('user-1');
    expect(categories.map((item) => item.id)).toEqual(['c1', 'c2']);

    const nowSpy = jest
      .spyOn(Date.prototype, 'toISOString')
      .mockReturnValue('2026-03-07T00:00:00.000Z');
    const created = await repository.createCategory({ userId: 'user-1', name: 'Church', color: '#fff' });
    expect(created).toEqual({
      userId: 'user-1',
      name: 'Church',
      color: '#fff',
      createdAt: '2026-03-07T00:00:00.000Z',
      id: 'new-category-id',
    });
    await repository.deleteCategory('c1');
    expect(mockCategoryDelete).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });
});
