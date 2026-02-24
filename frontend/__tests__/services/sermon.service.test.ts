// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

const API_BASE = 'http://localhost:3000';
const OFFLINE_ERROR = 'Offline: operation not available.';

const setNavigatorOnline = (online: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: online,
  });
};

// Import service functions dynamically to ensure fresh API_BASE value
let getSermonById: any;
let getSermons: any;
let createSermon: any;
let deleteSermon: any;
let updateSermon: any;
let updateSermonPreparation: any;

describe('Sermon Service', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockFetch.mockClear();
    // Set the environment variable before importing the service
    process.env.NEXT_PUBLIC_API_BASE = API_BASE;
    setNavigatorOnline(true);
    // Re-import the service functions for each test to get fresh API_BASE value
    const sermonService = await import('@/services/sermon.service');
    getSermonById = sermonService.getSermonById;
    getSermons = sermonService.getSermons;
    createSermon = sermonService.createSermon;
    deleteSermon = sermonService.deleteSermon;
    updateSermon = sermonService.updateSermon;
    updateSermonPreparation = sermonService.updateSermonPreparation;
  });

  afterEach(() => {
    // Clean up environment variable after each test
    delete process.env.NEXT_PUBLIC_API_BASE;
  });

  describe('getSermonById', () => {
    it('returns sermon data for successful response', async () => {
      const mockSermon = {
        id: 'test-id',
        title: 'Test Sermon',
        verse: 'John 3:16',
        date: '2024-01-01T00:00:00.000Z',
        thoughts: [],
        userId: 'user-1'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSermon,
      } as Response);

      const result = await getSermonById('test-id');

      expect(result).toEqual(mockSermon);
      expect(mockFetch).toHaveBeenCalledWith(`${API_BASE}/api/sermons/test-id`, { cache: 'no-store' });
    });

    it('returns undefined for 404 response (sermon not found)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      const result = await getSermonById('non-existent-id');

      expect(result).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(`${API_BASE}/api/sermons/non-existent-id`, { cache: 'no-store' });
    });

    it('throws error for other non-ok responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(getSermonById('test-id')).rejects.toThrow('Failed to fetch sermon');
    });

    it('throws error for network failures', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(getSermonById('test-id')).rejects.toThrow('Network error');
    });

    it('throws error when offline', async () => {
      setNavigatorOnline(false);
      await expect(getSermonById('test-id')).rejects.toThrow(OFFLINE_ERROR);
    });
  });

  describe('getSermons', () => {
    it('returns sermons sorted by date desc', async () => {
      const sermons = [
        { id: '1', date: '2024-01-01T00:00:00.000Z' },
        { id: '2', date: '2024-02-01T00:00:00.000Z' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => sermons,
      } as Response);

      const result = await getSermons('user-1');

      expect(mockFetch).toHaveBeenCalledWith(`${API_BASE}/api/sermons?userId=user-1`, {
        cache: 'no-store',
      });
      expect(result[0].id).toBe('2');
      expect(result[1].id).toBe('1');
    });

    it('throws error when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(getSermons('user-1')).rejects.toThrow('Failed to fetch sermons');
    });

    it('throws error when offline', async () => {
      setNavigatorOnline(false);
      await expect(getSermons('user-1')).rejects.toThrow(OFFLINE_ERROR);
    });
  });

  describe('createSermon', () => {
    it('creates a sermon successfully', async () => {
      const sermon = { title: 'Test', verse: 'John 3:16', date: '2024-01-01', userId: 'user-1', thoughts: [] };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sermon: { ...sermon, id: 'new-id' } }),
      } as Response);

      const result = await createSermon(sermon);

      expect(mockFetch).toHaveBeenCalledWith(`${API_BASE}/api/sermons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sermon),
      });
      expect(result.id).toBe('new-id');
    });

    it('throws error when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(createSermon({ title: 'Test' } as any)).rejects.toThrow('Failed to create sermon');
    });

    it('throws error when offline', async () => {
      setNavigatorOnline(false);
      await expect(createSermon({ title: 'Test' } as any)).rejects.toThrow(OFFLINE_ERROR);
    });
  });

  describe('deleteSermon', () => {
    it('deletes a sermon successfully', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true } as Response);

      await deleteSermon('sermon-1');

      expect(mockFetch).toHaveBeenCalledWith(`${API_BASE}/api/sermons/sermon-1`, {
        method: 'DELETE',
      });
    });

    it('throws error when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false } as Response);

      await expect(deleteSermon('sermon-1')).rejects.toThrow('Failed to delete sermon with id sermon-1');
    });

    it('throws error when offline', async () => {
      setNavigatorOnline(false);
      await expect(deleteSermon('sermon-1')).rejects.toThrow(OFFLINE_ERROR);
    });
  });

  describe('updateSermon', () => {
    it('returns updated sermon when response is ok', async () => {
      const sermon = { id: 'sermon-1', title: 'Updated' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => sermon,
      } as Response);

      const result = await updateSermon(sermon);

      expect(mockFetch).toHaveBeenCalledWith(`${API_BASE}/api/sermons/sermon-1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sermon),
      });
      expect(result).toEqual(sermon);
    });

    it('returns null when offline', async () => {
      setNavigatorOnline(false);
      const result = await updateSermon({ id: 'sermon-1' } as any);
      expect(result).toBeNull();
    });

    it('returns null when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);

      const result = await updateSermon({ id: 'sermon-1' } as any);
      expect(result).toBeNull();
    });

    it('returns null when request throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await updateSermon({ id: 'sermon-1' } as any);
      expect(result).toBeNull();
    });
  });

  describe('updateSermonPreparation', () => {
    it('returns preparation from response', async () => {
      const updates = { notes: 'Test' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ preparation: updates }),
      } as Response);

      const result = await updateSermonPreparation('sermon-1', updates);

      expect(result).toEqual(updates);
    });

    it('falls back to provided updates when response has no preparation', async () => {
      const updates = { notes: 'Test' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response);

      const result = await updateSermonPreparation('sermon-1', updates);

      expect(result).toEqual(updates);
    });

    it('returns null when offline', async () => {
      setNavigatorOnline(false);
      const result = await updateSermonPreparation('sermon-1', { notes: 'Test' });
      expect(result).toBeNull();
    });

    it('returns null when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);

      const result = await updateSermonPreparation('sermon-1', { notes: 'Test' });
      expect(result).toBeNull();
    });
  });
});
