import { GroupsRepository } from '@/api/repositories/groups.repository';

const mockGet = jest.fn();
const mockDoc = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
  },
}));

const { adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminDb: { collection: jest.Mock<unknown, unknown[]> };
};

const mockCollection = adminDb.collection;

const baseGroup = {
  userId: 'user-1',
  title: 'Group',
  description: 'Desc',
  status: 'draft',
  templates: [{ id: 't1', type: 'topic', title: 'Topic', content: '', status: 'draft' }],
  flow: [
    { id: 'f2', templateId: 't1', order: 2, durationMin: null },
    { id: 'f1', templateId: 't1', order: 1, durationMin: null },
  ],
  meetingDates: [{ id: 'd1', date: '2026-02-10', createdAt: '2026-02-01T00:00:00Z' }],
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-02T00:00:00Z',
  seriesId: null,
  seriesPosition: null,
};

const setupFirestoreMocks = () => {
  mockCollection.mockReturnValue({
    doc: mockDoc.mockReturnValue({
      get: mockGet,
      update: mockUpdate.mockResolvedValue(undefined),
      delete: mockDelete.mockResolvedValue(undefined),
    }),
  });
};

describe('GroupsRepository', () => {
  let repository: GroupsRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    setupFirestoreMocks();
    repository = new GroupsRepository();
  });

  it('filters undefined fields via private helper', () => {
    const filtered = (repository as any).filterUndefinedValues({
      a: 1,
      b: undefined,
      c: null,
      d: '',
    });

    expect(filtered).toEqual({ a: 1, c: null, d: '' });
  });

  it('fetches one group or returns null when missing', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      id: 'g1',
      data: () => ({ ...baseGroup }),
    });

    const found = await repository.fetchGroupById('g1');
    expect(found?.id).toBe('g1');
    expect(found?.flow[0].order).toBe(1);

    mockGet.mockResolvedValueOnce({
      exists: false,
      id: 'missing',
      data: () => null,
    });
    const missing = await repository.fetchGroupById('missing');
    expect(missing).toBeNull();
  });

  it('updates group and rejects unknown ids', async () => {
    jest.spyOn(repository, 'fetchGroupById').mockResolvedValueOnce(null);
    await expect(repository.updateGroup('missing', { title: 'x' })).rejects.toThrow('Group not found');

    jest.spyOn(repository, 'fetchGroupById').mockResolvedValueOnce({
      id: 'g1',
      ...baseGroup,
      flow: [{ id: 'f1', templateId: 't1', order: 9, durationMin: null }],
    } as any);

    const result = await repository.updateGroup('g1', {
      title: 'Updated',
      flow: [
        { id: 'f2', templateId: 't1', order: 2, durationMin: null },
        { id: 'f1', templateId: 't1', order: 1, durationMin: null },
      ] as any,
    });

    expect(mockUpdate).toHaveBeenCalled();
    expect(result.title).toBe('Updated');
    expect(result.flow.map((item) => item.order)).toEqual([1, 2]);
  });

  it('updates series linkage only when data provided', async () => {
    await repository.updateGroupSeriesInfo('g1', undefined as any, undefined as any);
    expect(mockUpdate).not.toHaveBeenCalled();

    await repository.updateGroupSeriesInfo('g1', 'series-1', 4);
    expect(mockUpdate).toHaveBeenCalledWith({ seriesId: 'series-1', seriesPosition: 4 });
  });

  it('adds, updates and deletes meeting dates', async () => {
    jest.spyOn(repository, 'fetchGroupById').mockResolvedValue({
      id: 'g1',
      ...baseGroup,
    } as any);
    const updateSpy = jest.spyOn(repository, 'updateGroup').mockResolvedValue({ id: 'g1' } as any);

    const created = await repository.addMeetingDate('g1', { date: '2026-02-11' });
    expect(created.id).toBeTruthy();
    expect(updateSpy).toHaveBeenCalledWith(
      'g1',
      expect.objectContaining({ meetingDates: expect.any(Array) })
    );

    jest.spyOn(repository, 'fetchGroupById').mockResolvedValue({
      id: 'g1',
      ...baseGroup,
      meetingDates: [
        { id: 'd1', date: '2026-02-10', createdAt: 'x' },
        { id: 'd2', date: '2026-02-12', createdAt: 'y' },
      ],
    } as any);

    const updated = await repository.updateMeetingDate('g1', 'd2', { notes: 'updated' });
    expect(updated.id).toBe('d2');
    expect(updated.notes).toBe('updated');

    await repository.deleteMeetingDate('g1', 'd1');
    expect(updateSpy).toHaveBeenCalled();

    await expect(repository.updateMeetingDate('g1', 'missing', { notes: 'x' })).rejects.toThrow(
      'Meeting date not found'
    );
  });
});
