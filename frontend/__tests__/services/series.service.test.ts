import { Series } from '@/models/models';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Import service functions inside the describe block to ensure fresh module load
let getAllSeries: any;
let getSeriesById: any;
let createSeries: any;
let updateSeries: any;
let deleteSeries: any;
let addSermonToSeries: any;
let removeSermonFromSeries: any;
let reorderSermons: any;

describe('Series Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockClear();
    // Set the environment variable before importing the service
    process.env.NEXT_PUBLIC_API_BASE = '';
    // Re-import the service functions for each test to get fresh API_BASE value
    const seriesService = require('@/services/series.service');
    getAllSeries = seriesService.getAllSeries;
    getSeriesById = seriesService.getSeriesById;
    createSeries = seriesService.createSeries;
    updateSeries = seriesService.updateSeries;
    deleteSeries = seriesService.deleteSeries;
    addSermonToSeries = seriesService.addSermonToSeries;
    removeSermonFromSeries = seriesService.removeSermonFromSeries;
    reorderSermons = seriesService.reorderSermons;
  });

  afterEach(() => {
    // Clean up environment variable after each test
    delete process.env.NEXT_PUBLIC_API_BASE;
  });

  describe('getAllSeries', () => {
    const mockSeries: Series[] = [
      {
        id: 'series-1',
        userId: 'user-1',
        title: 'Series A',
        theme: 'Theme A',
        description: 'Description A',
        bookOrTopic: 'Book A',
        sermonIds: [],
        status: 'active',
        color: '#FF0000',
        createdAt: '2024-01-02T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      },
      {
        id: 'series-2',
        userId: 'user-1',
        title: 'Series B',
        theme: 'Theme B',
        description: 'Description B',
        bookOrTopic: 'Book B',
        sermonIds: [],
        status: 'draft',
        color: '#00FF00',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        startDate: '2024-01-15T00:00:00Z',
      },
    ];

    it('should fetch and sort series by startDate desc, then title', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockSeries),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await getAllSeries('user-1');

      expect(mockFetch).toHaveBeenCalledWith(`/api/series?userId=user-1`, {
        cache: 'no-store',
      });
      expect(mockResponse.json).toHaveBeenCalled();

      // Should be sorted: series-2 (has startDate) before series-1 (no startDate)
      expect(result[0].title).toBe('Series B'); // has startDate, comes first
      expect(result[1].title).toBe('Series A'); // no startDate, comes second
    });

    it('should return empty array on API error', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
      };
      mockFetch.mockResolvedValue(mockResponse);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await getAllSeries('user-1');

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith('getAllSeries: Response not ok, status: 500');

      consoleSpy.mockRestore();
    });

    it('should return empty array on fetch error', async () => {
      const error = new Error('Network error');
      mockFetch.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await getAllSeries('user-1');

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith('getAllSeries: Error fetching series:', error);

      consoleSpy.mockRestore();
    });
  });

  describe('getSeriesById', () => {
    const mockSeries: Series = {
      id: 'series-1',
      userId: 'user-1',
      title: 'Test Series',
      theme: 'Test Theme',
      description: 'Test Description',
      bookOrTopic: 'Test Book',
      sermonIds: [],
      status: 'active',
      color: '#FF0000',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    it('should fetch series by id successfully', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockSeries),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await getSeriesById('series-1');

      expect(mockFetch).toHaveBeenCalledWith(`/api/series/series-1`);
      expect(result).toEqual(mockSeries);
    });

    it('should return undefined on API error', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
      };
      mockFetch.mockResolvedValue(mockResponse);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await getSeriesById('series-1');

      expect(result).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith('getSeriesById: Response not ok for id series-1, status: 404');

      consoleSpy.mockRestore();
    });

    it('should return undefined on fetch error', async () => {
      const error = new Error('Network error');
      mockFetch.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await getSeriesById('series-1');

      expect(result).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith('getSeriesById: Error fetching series series-1:', error);

      consoleSpy.mockRestore();
    });
  });

  describe('createSeries', () => {
    const newSeriesData = {
      userId: 'user-1',
      title: 'New Series',
      theme: 'New Theme',
      description: 'New Description',
      bookOrTopic: 'New Book',
      sermonIds: [],
      status: 'draft' as const,
      color: '#0000FF',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    const createdSeries = { ...newSeriesData, id: 'new-series-id' };

    it('should create series successfully', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({ series: createdSeries }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await createSeries(newSeriesData);

      expect(mockFetch).toHaveBeenCalledWith(`/api/series`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSeriesData),
      });
      expect(result).toEqual(createdSeries);
    });

    it('should throw error on API error', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
      };
      mockFetch.mockResolvedValue(mockResponse);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(createSeries(newSeriesData)).rejects.toThrow('Failed to create series');

      expect(consoleSpy).toHaveBeenCalledWith('createSeries: Response not ok, status:', 400);

      consoleSpy.mockRestore();
    });

    it('should throw error on fetch error', async () => {
      const error = new Error('Network error');
      mockFetch.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(createSeries(newSeriesData)).rejects.toThrow(error);

      expect(consoleSpy).toHaveBeenCalledWith('createSeries: Error creating series:', error);

      consoleSpy.mockRestore();
    });
  });

  describe('updateSeries', () => {
    const updates = { title: 'Updated Title', theme: 'Updated Theme' };
    const updatedSeries: Series = {
      id: 'series-1',
      userId: 'user-1',
      title: 'Updated Title',
      theme: 'Updated Theme',
      description: 'Original Description',
      bookOrTopic: 'Original Book',
      sermonIds: [],
      status: 'active',
      color: '#FF0000',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    };

    it('should update series successfully', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(updatedSeries),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await updateSeries('series-1', updates);

      expect(mockFetch).toHaveBeenCalledWith(`/api/series/series-1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      expect(result).toEqual(updatedSeries);
    });

    it('should throw error on API error', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
      };
      mockFetch.mockResolvedValue(mockResponse);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(updateSeries('series-1', updates)).rejects.toThrow('Failed to update series');

      expect(consoleSpy).toHaveBeenCalledWith('updateSeries: Response not ok for id series-1, status:', 404);

      consoleSpy.mockRestore();
    });

    it('should throw error on fetch error', async () => {
      const error = new Error('Network error');
      mockFetch.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(updateSeries('series-1', updates)).rejects.toThrow(error);

      expect(consoleSpy).toHaveBeenCalledWith('updateSeries: Error updating series series-1:', error);

      consoleSpy.mockRestore();
    });
  });

  describe('deleteSeries', () => {
    it('should delete series successfully', async () => {
      const mockResponse = {
        ok: true,
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(deleteSeries('series-1')).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(`/api/series/series-1`, {
        method: 'DELETE',
      });
    });

    it('should throw error on API error', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
      };
      mockFetch.mockResolvedValue(mockResponse);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(deleteSeries('series-1')).rejects.toThrow('Failed to delete series');

      expect(consoleSpy).toHaveBeenCalledWith('deleteSeries: Response not ok for id series-1, status:', 404);

      consoleSpy.mockRestore();
    });

    it('should throw error on fetch error', async () => {
      const error = new Error('Network error');
      mockFetch.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(deleteSeries('series-1')).rejects.toThrow(error);

      expect(consoleSpy).toHaveBeenCalledWith('deleteSeries: Error deleting series series-1:', error);

      consoleSpy.mockRestore();
    });
  });

  describe('addSermonToSeries', () => {
    it('should add sermon to series successfully', async () => {
      const mockResponse = {
        ok: true,
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(addSermonToSeries('series-1', 'sermon-1', 2)).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(`/api/series/series-1/sermons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sermonId: 'sermon-1', position: 2 }),
      });
    });

    it('should add sermon without position', async () => {
      const mockResponse = {
        ok: true,
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(addSermonToSeries('series-1', 'sermon-1')).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(`/api/series/series-1/sermons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sermonId: 'sermon-1', position: undefined }),
      });
    });

    it('should throw error on API error', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
      };
      mockFetch.mockResolvedValue(mockResponse);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(addSermonToSeries('series-1', 'sermon-1')).rejects.toThrow('Failed to add sermon to series');

      expect(consoleSpy).toHaveBeenCalledWith('addSermonToSeries: Response not ok for series series-1, sermon sermon-1, status:', 400);

      consoleSpy.mockRestore();
    });

    it('should throw error on fetch error', async () => {
      const error = new Error('Network error');
      mockFetch.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(addSermonToSeries('series-1', 'sermon-1')).rejects.toThrow(error);

      expect(consoleSpy).toHaveBeenCalledWith('addSermonToSeries: Error adding sermon sermon-1 to series series-1:', error);

      consoleSpy.mockRestore();
    });
  });

  describe('removeSermonFromSeries', () => {
    it('should remove sermon from series successfully', async () => {
      const mockResponse = {
        ok: true,
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(removeSermonFromSeries('series-1', 'sermon-1')).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(`/api/series/series-1/sermons?sermonId=sermon-1`, {
        method: 'DELETE',
      });
    });

    it('should throw error on API error', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
      };
      mockFetch.mockResolvedValue(mockResponse);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(removeSermonFromSeries('series-1', 'sermon-1')).rejects.toThrow('Failed to remove sermon from series');

      expect(consoleSpy).toHaveBeenCalledWith('removeSermonFromSeries: Response not ok for series series-1, sermon sermon-1, status:', 404);

      consoleSpy.mockRestore();
    });

    it('should throw error on fetch error', async () => {
      const error = new Error('Network error');
      mockFetch.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(removeSermonFromSeries('series-1', 'sermon-1')).rejects.toThrow(error);

      expect(consoleSpy).toHaveBeenCalledWith('removeSermonFromSeries: Error removing sermon sermon-1 from series series-1:', error);

      consoleSpy.mockRestore();
    });
  });

  describe('reorderSermons', () => {
    it('should reorder sermons successfully', async () => {
      const sermonIds = ['sermon-2', 'sermon-1', 'sermon-3'];
      const mockResponse = {
        ok: true,
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(reorderSermons('series-1', sermonIds)).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(`/api/series/series-1/sermons`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sermonIds }),
      });
    });

    it('should throw error on API error', async () => {
      const sermonIds = ['sermon-1', 'sermon-2'];
      const mockResponse = {
        ok: false,
        status: 400,
      };
      mockFetch.mockResolvedValue(mockResponse);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(reorderSermons('series-1', sermonIds)).rejects.toThrow('Failed to reorder sermons');

      expect(consoleSpy).toHaveBeenCalledWith('reorderSermons: Response not ok for series series-1, status:', 400);

      consoleSpy.mockRestore();
    });

    it('should throw error on fetch error', async () => {
      const error = new Error('Network error');
      mockFetch.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(reorderSermons('series-1', ['sermon-1'])).rejects.toThrow(error);

      expect(consoleSpy).toHaveBeenCalledWith('reorderSermons: Error reordering sermons in series series-1:', error);

      consoleSpy.mockRestore();
    });
  });
});
