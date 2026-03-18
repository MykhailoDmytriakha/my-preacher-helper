import {
  addPrayerUpdate,
  createPrayerRequest,
  deletePrayerRequest,
  getAllPrayerRequests,
  getPrayerRequestById,
  setPrayerStatus,
  updatePrayerRequest,
} from '@/services/prayerRequests.service';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('prayerRequests.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_API_BASE = '';
    Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: true });
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE;
  });

  it('fetches prayer collections and prayer detail', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'p1', title: 'Prayer 1' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'p1', title: 'Prayer 1' }),
      });

    const all = await getAllPrayerRequests('user-1');
    const one = await getPrayerRequestById('p1');

    expect(all).toHaveLength(1);
    expect(one?.id).toBe('p1');
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/api/prayer?userId=user-1'),
      { cache: 'no-store' }
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/prayer/p1'),
      { cache: 'no-store' }
    );
  });

  it('creates, updates, deletes, appends updates, and changes status', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'p1', title: 'Created prayer' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'p1', title: 'Updated prayer' }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'p1', updates: [{ id: 'u1', text: 'Fresh update' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'p1', status: 'answered', answerText: 'Yes' }),
      });

    const created = await createPrayerRequest({ userId: 'user-1', title: 'Created prayer', tags: ['faith'] } as any);
    const updated = await updatePrayerRequest('p1', { title: 'Updated prayer' });
    await deletePrayerRequest('p1');
    const appended = await addPrayerUpdate('p1', 'Fresh update');
    const answered = await setPrayerStatus('p1', 'answered', 'Yes');

    expect(created.id).toBe('p1');
    expect(updated.title).toBe('Updated prayer');
    expect(appended.updates).toHaveLength(1);
    expect(answered.answerText).toBe('Yes');

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/api/prayer'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/prayer/p1'),
      expect.objectContaining({ method: 'PUT' })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('/api/prayer/p1'),
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('/api/prayer/p1/updates'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining('/api/prayer/p1/status'),
      expect.objectContaining({ method: 'PUT' })
    );

    const [, createOptions] = mockFetch.mock.calls[0];
    expect((createOptions as RequestInit).body).toContain('"title":"Created prayer"');

    const [, statusOptions] = mockFetch.mock.calls[4];
    expect((statusOptions as RequestInit).body).toContain('"answerText":"Yes"');
  });

  it('throws api errors for failed network responses', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false });

    await expect(getAllPrayerRequests('user-1')).rejects.toThrow('Failed to fetch prayer requests');
    await expect(getPrayerRequestById('p1')).rejects.toThrow('Failed to fetch prayer request');
    await expect(createPrayerRequest({ userId: 'user-1', title: 'x' } as any)).rejects.toThrow(
      'Failed to create prayer request'
    );
    await expect(updatePrayerRequest('p1', { title: 'x' })).rejects.toThrow('Failed to update prayer request');
    await expect(deletePrayerRequest('p1')).rejects.toThrow('Failed to delete prayer request');
    await expect(addPrayerUpdate('p1', 'x')).rejects.toThrow('Failed to add prayer update');
    await expect(setPrayerStatus('p1', 'active')).rejects.toThrow('Failed to update prayer status');
  });

  it('blocks every network operation while offline', async () => {
    Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: false });

    await expect(getAllPrayerRequests('user-1')).rejects.toThrow('Offline: operation not available.');
    await expect(getPrayerRequestById('p1')).rejects.toThrow('Offline: operation not available.');
    await expect(createPrayerRequest({ userId: 'user-1', title: 'x' } as any)).rejects.toThrow(
      'Offline: operation not available.'
    );
    await expect(updatePrayerRequest('p1', { title: 'x' })).rejects.toThrow('Offline: operation not available.');
    await expect(deletePrayerRequest('p1')).rejects.toThrow('Offline: operation not available.');
    await expect(addPrayerUpdate('p1', 'x')).rejects.toThrow('Offline: operation not available.');
    await expect(setPrayerStatus('p1', 'active')).rejects.toThrow('Offline: operation not available.');

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
