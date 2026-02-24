import {
  addGroupMeetingDate,
  createGroup,
  deleteGroup,
  deleteGroupMeetingDate,
  fetchCalendarGroups,
  getAllGroups,
  getGroupById,
  updateGroup,
  updateGroupMeetingDate,
} from '@/services/groups.service';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const baseGroup = {
  userId: 'user-1',
  title: 'Group 1',
  status: 'draft' as const,
  templates: [],
  flow: [],
  meetingDates: [],
  createdAt: '2026-02-10T00:00:00.000Z',
  updatedAt: '2026-02-10T00:00:00.000Z',
  seriesId: null,
  seriesPosition: null,
};

describe('groups.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_API_BASE = '';
    Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: true });
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE;
  });

  it('fetches all groups and group detail', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'g1', ...baseGroup }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'g1', ...baseGroup }),
      });

    const all = await getAllGroups('user-1');
    const byId = await getGroupById('g1');

    expect(all).toHaveLength(1);
    expect(byId?.id).toBe('g1');
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/api/groups?userId=user-1'),
      { cache: 'no-store' }
    );
    expect(mockFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/groups/g1'), { cache: 'no-store' });
  });

  it('creates, updates and deletes group', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ group: { id: 'g1', ...baseGroup } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'g1', ...baseGroup, title: 'Updated' }),
      })
      .mockResolvedValueOnce({
        ok: true,
      });

    const created = await createGroup(baseGroup);
    const updated = await updateGroup('g1', { title: 'Updated' });
    await deleteGroup('g1');

    expect(created.id).toBe('g1');
    expect(updated.title).toBe('Updated');
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/api/groups'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/groups/g1'),
      expect.objectContaining({ method: 'PUT' })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('/api/groups/g1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('handles meeting dates and calendar groups responses', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ meetingDate: { id: 'd1', date: '2026-02-11', createdAt: 'x' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ meetingDate: { id: 'd1', date: '2026-02-12', createdAt: 'x' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ groups: [{ id: 'g1', ...baseGroup }] }),
      });

    const added = await addGroupMeetingDate('g1', { date: '2026-02-11' });
    const updated = await updateGroupMeetingDate('g1', 'd1', { date: '2026-02-12' });
    await deleteGroupMeetingDate('g1', 'd1');
    const calendar = await fetchCalendarGroups('user-1', '2026-02-01', '2026-02-28');

    expect(added.id).toBe('d1');
    expect(updated.date).toBe('2026-02-12');
    expect(calendar).toHaveLength(1);
    expect(mockFetch).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('/api/calendar/groups?userId=user-1&startDate=2026-02-01&endDate=2026-02-28')
    );
  });

  it('throws api errors for non-ok responses', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Bad add' }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Bad update' }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Bad delete' }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Bad calendar' }) });

    await expect(getAllGroups('user-1')).rejects.toThrow('Failed to fetch groups');
    await expect(getGroupById('missing')).rejects.toThrow('Failed to fetch group');
    await expect(addGroupMeetingDate('g1', { date: '2026-02-11' })).rejects.toThrow('Bad add');
    await expect(updateGroupMeetingDate('g1', 'd1', { date: 'x' })).rejects.toThrow('Bad update');
    await expect(deleteGroupMeetingDate('g1', 'd1')).rejects.toThrow('Bad delete');
    await expect(fetchCalendarGroups('user-1')).rejects.toThrow('Bad calendar');
  });

  it('blocks network operations when browser is offline', async () => {
    Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: false });

    await expect(getAllGroups('user-1')).rejects.toThrow('Offline: operation not available.');
    await expect(getGroupById('g1')).rejects.toThrow('Offline: operation not available.');
    await expect(createGroup(baseGroup)).rejects.toThrow('Offline: operation not available.');
    await expect(updateGroup('g1', { title: 'x' })).rejects.toThrow('Offline: operation not available.');
    await expect(deleteGroup('g1')).rejects.toThrow('Offline: operation not available.');

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
