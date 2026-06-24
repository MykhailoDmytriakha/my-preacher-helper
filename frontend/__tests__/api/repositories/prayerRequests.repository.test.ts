import { PrayerRequestsRepository } from '@/api/repositories/prayerRequests.repository';

const mockPrayerAdd = jest.fn();
const mockPrayerGet = jest.fn();
const mockPrayerDoc = jest.fn();
const mockPrayerSet = jest.fn();

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
  },
}));

const { adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminDb: { collection: jest.Mock<unknown, unknown[]> };
};

const mockCollection = adminDb.collection;

const setupFirestoreMocks = () => {
  mockCollection.mockImplementation((collectionName: unknown) => {
    const name = String(collectionName);
    if (name === 'prayerRequests') {
      return {
        add: mockPrayerAdd.mockResolvedValue({ id: 'new-prayer-id' }),
        doc: mockPrayerDoc.mockReturnValue({
          get: mockPrayerGet,
          set: mockPrayerSet.mockResolvedValue(undefined),
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

  it('creates with a client-supplied id via doc().set() (idempotent path)', async () => {
    mockPrayerGet.mockResolvedValue({ exists: false });

    const created = await repository.create(
      { userId: 'user-1', title: 'Client id prayer', tags: [], status: 'active', updates: [] },
      'client-uuid-1'
    );

    expect(mockPrayerDoc).toHaveBeenCalledWith('client-uuid-1');
    expect(mockPrayerSet).toHaveBeenCalledTimes(1);
    expect(mockPrayerAdd).not.toHaveBeenCalled(); // not the auto-id path
    expect(created.id).toBe('client-uuid-1');
  });

  it('is idempotent: replaying a create for an existing same-user doc returns it without re-writing', async () => {
    mockPrayerGet.mockResolvedValue({
      exists: true,
      data: () => ({ userId: 'user-1', title: 'Already there', tags: [], status: 'active', updates: [] }),
    });

    const created = await repository.create(
      { userId: 'user-1', title: 'Replay', tags: [], status: 'active', updates: [] },
      'client-uuid-1'
    );

    expect(created.id).toBe('client-uuid-1');
    expect(created.title).toBe('Already there'); // existing doc, not re-written
    expect(mockPrayerSet).not.toHaveBeenCalled(); // no duplicate write
  });

  it('rejects a client id that belongs to another user (ownership guard)', async () => {
    mockPrayerGet.mockResolvedValue({
      exists: true,
      data: () => ({ userId: 'other-user', title: 'Theirs', tags: [], status: 'active', updates: [] }),
    });

    await expect(
      repository.create(
        { userId: 'user-1', title: 'Hijack', tags: [], status: 'active', updates: [] },
        'client-uuid-1'
      )
    ).rejects.toThrow('Forbidden');
    expect(mockPrayerSet).not.toHaveBeenCalled();
  });
});
