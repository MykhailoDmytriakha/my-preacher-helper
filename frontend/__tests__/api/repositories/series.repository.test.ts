import { SeriesRepository } from '@/api/repositories/series.repository';
import { Series } from '@/models/models';

// Mock Firestore
const mockAdd = jest.fn();
const mockDoc = jest.fn();
const mockWhere = jest.fn();
const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();

const mockSeriesData = {
  userId: 'user-1',
  title: 'Test Series',
  theme: 'Test Theme',
  description: 'Test Description',
  bookOrTopic: 'Test Book',
  sermonIds: ['sermon-1', 'sermon-2'],
  status: 'active',
  color: '#FF0000',
  createdAt: '2024-01-01T10:00:00Z',
  updatedAt: '2024-01-01T11:00:00Z',
};

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
  },
}));

const { adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminDb: {
    collection: jest.Mock<unknown, unknown[]>;
  };
};

const mockCollection = adminDb.collection;


const mockDocumentSnapshot = {
  exists: true,
  id: 'series-1',
  data: () => ({ ...mockSeriesData }),
};

const mockDocumentReference = {
  id: 'new-series-id',
  update: mockUpdate,
  delete: mockDelete,
};

const setupFirestoreMocks = () => {
  mockCollection.mockReturnValue({
    add: mockAdd.mockResolvedValue(mockDocumentReference),
    doc: mockDoc.mockReturnValue({
      get: mockGet,
      update: mockUpdate.mockResolvedValue(undefined),
      delete: mockDelete.mockResolvedValue(undefined),
    }),
    where: mockWhere.mockReturnValue({
      get: mockGet,
    }),
  });

  mockGet.mockResolvedValue(mockDocumentSnapshot);
};

// Mock Date to return consistent timestamps
const mockDate = new Date('2024-01-01T12:00:00Z');
jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);
mockDate.toISOString = jest.fn().mockReturnValue('2024-01-01T12:00:00.000Z');

describe('SeriesRepository', () => {
  let repository: SeriesRepository;

  const { ...seriesWithoutTimestamps } = mockSeriesData;

  const mockSeries: Omit<Series, 'id' | 'createdAt' | 'updatedAt'> = {
    ...seriesWithoutTimestamps,
    status: seriesWithoutTimestamps.status as 'draft' | 'active' | 'completed'
  };

  const mockSeriesDoc = {
    id: 'series-1',
    data: () => ({
      ...mockSeriesData,
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    setupFirestoreMocks();
    repository = new SeriesRepository();
  });

  describe('filterUndefinedValues', () => {
    it('should filter out undefined values', () => {
      const input = { a: 1, b: undefined, c: 'test', d: null, e: 0 };
      const result = (repository as any).filterUndefinedValues(input);
      expect(result).toEqual({ a: 1, c: 'test', d: null, e: 0 });
    });
  });

  describe('createSeries', () => {
    it('should create a series successfully', async () => {
      const result = await repository.createSeries(mockSeries);

      expect(mockCollection).toHaveBeenCalledWith('series');
      expect(mockAdd).toHaveBeenCalledWith({
        ...mockSeries,
        createdAt: '2024-01-01T12:00:00.000Z',
        updatedAt: '2024-01-01T12:00:00.000Z',
      });

      expect(result).toEqual({
        ...mockSeries,
        id: 'new-series-id',
        createdAt: '2024-01-01T12:00:00.000Z',
        updatedAt: '2024-01-01T12:00:00.000Z',
      });
    });

    it('should filter undefined values before saving', async () => {
      const seriesWithUndefined = {
        ...mockSeries,
        description: undefined,
        startDate: '2024-01-01T00:00:00Z',
      };

      await repository.createSeries(seriesWithUndefined);

      const savedData = mockAdd.mock.calls[0][0];
      expect(savedData.description).toBeUndefined();
      expect(savedData.startDate).toBe('2024-01-01T00:00:00Z');
    });

    it('should throw error on Firestore error', async () => {
      const error = new Error('Firestore error');
      mockAdd.mockRejectedValue(error);

      await expect(repository.createSeries(mockSeries)).rejects.toThrow('Firestore error');
    });
  });

  describe('fetchSeriesByUserId', () => {
    it('should fetch and sort series by userId', async () => {
      const seriesWithDates = [
        {
          ...mockSeriesDoc,
          data: () => ({
            ...mockSeriesDoc.data(),
            startDate: '2024-01-01T00:00:00Z',
          }),
        },
        {
          ...mockSeriesDoc,
          id: 'series-2',
          data: () => ({
            ...mockSeriesDoc.data(),
            title: 'Earlier Series',
            startDate: '2023-12-01T00:00:00Z',
          }),
        },
      ];

      mockGet.mockResolvedValueOnce({ docs: seriesWithDates });

      const result = await repository.fetchSeriesByUserId('user-1');

      expect(mockCollection).toHaveBeenCalledWith('series');
      expect(mockWhere).toHaveBeenCalledWith('userId', '==', 'user-1');
      expect(result).toHaveLength(2);
      // Should be sorted by startDate desc: series-1 (2024) before series-2 (2023)
      expect(result[0].startDate).toBe('2024-01-01T00:00:00Z');
      expect(result[1].startDate).toBe('2023-12-01T00:00:00Z');
    });

    it('should handle series without startDate (sort to end)', async () => {
      const seriesMixed = [
        {
          ...mockSeriesDoc,
          data: () => ({
            ...mockSeriesDoc.data(),
            startDate: '2024-01-01T00:00:00Z',
          }),
        },
        {
          ...mockSeriesDoc,
          id: 'series-2',
          data: () => ({
            ...mockSeriesDoc.data(),
            title: 'No Date Series',
            startDate: undefined,
          }),
        },
      ];

      mockGet.mockResolvedValueOnce({ docs: seriesMixed });

      const result = await repository.fetchSeriesByUserId('user-1');

      expect(result[0].startDate).toBe('2024-01-01T00:00:00Z');
      expect(result[1].startDate).toBeUndefined();
    });

    it('should return empty array when no series found', async () => {
      mockGet.mockResolvedValueOnce({ docs: [] });

      const result = await repository.fetchSeriesByUserId('user-1');

      expect(result).toEqual([]);
    });

    it('should throw error on Firestore error', async () => {
      const error = new Error('Firestore error');
      mockGet.mockRejectedValue(error);

      await expect(repository.fetchSeriesByUserId('user-1')).rejects.toThrow('Firestore error');
    });
  });

  describe('fetchSeriesById', () => {
    it('should fetch series by id successfully', async () => {
      const result = await repository.fetchSeriesById('series-1');

      expect(mockCollection).toHaveBeenCalledWith('series');
      expect(mockDoc).toHaveBeenCalledWith('series-1');
      expect(result).toEqual({
        id: 'series-1',
        ...mockSeriesDoc.data(),
      });
    });

    it('should return null when series not found', async () => {
      mockGet.mockResolvedValueOnce({
        exists: false,
        id: 'series-1',
        data: () => null,
      });

      const result = await repository.fetchSeriesById('series-1');

      expect(result).toBeNull();
    });

    it('should throw error on Firestore error', async () => {
      const error = new Error('Firestore error');
      mockGet.mockRejectedValue(error);

      await expect(repository.fetchSeriesById('series-1')).rejects.toThrow('Firestore error');
    });
  });

  describe('updateSeries', () => {
    it('should update series successfully', async () => {
      const updates = { title: 'Updated Title', theme: 'Updated Theme' };

      await repository.updateSeries('series-1', updates);

      expect(mockCollection).toHaveBeenCalledWith('series');
      expect(mockDoc).toHaveBeenCalledWith('series-1');
      expect(mockUpdate).toHaveBeenCalledWith({
        ...updates,
        updatedAt: '2024-01-01T12:00:00.000Z',
      });
    });

    it('should filter undefined values before updating', async () => {
      const updates = { title: 'Updated Title', description: undefined, theme: 'Updated Theme' };

      await repository.updateSeries('series-1', updates);

      expect(mockUpdate).toHaveBeenCalledWith({
        title: 'Updated Title',
        theme: 'Updated Theme',
        updatedAt: '2024-01-01T12:00:00.000Z',
      });
    });

    it('should throw error on Firestore error', async () => {
      const error = new Error('Firestore error');
      mockUpdate.mockRejectedValue(error);

      await expect(repository.updateSeries('series-1', { title: 'Updated' })).rejects.toThrow('Firestore error');
    });
  });

  describe('deleteSeries', () => {
    it('should delete series successfully', async () => {
      await repository.deleteSeries('series-1');

      expect(mockCollection).toHaveBeenCalledWith('series');
      expect(mockDoc).toHaveBeenCalledWith('series-1');
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should throw error on Firestore error', async () => {
      const error = new Error('Firestore error');
      mockDelete.mockRejectedValue(error);

      await expect(repository.deleteSeries('series-1')).rejects.toThrow('Firestore error');
    });
  });

  describe('addSermonToSeries', () => {
    it('should add sermon at the end when no position specified', async () => {
      await repository.addSermonToSeries('series-1', 'sermon-3');

      expect(mockUpdate).toHaveBeenCalledWith({
        sermonIds: ['sermon-1', 'sermon-2', 'sermon-3'],
        updatedAt: '2024-01-01T12:00:00.000Z',
      });
    });

    it('should add sermon at specific position', async () => {
      await repository.addSermonToSeries('series-1', 'sermon-3', 1);

      expect(mockUpdate).toHaveBeenCalledWith({
        sermonIds: ['sermon-1', 'sermon-3', 'sermon-2'],
        updatedAt: '2024-01-01T12:00:00.000Z',
      });
    });

    it('should move existing sermon to new position', async () => {
      await repository.addSermonToSeries('series-1', 'sermon-1', 1);

      expect(mockUpdate).toHaveBeenCalledWith({
        sermonIds: ['sermon-2', 'sermon-1'],
        updatedAt: '2024-01-01T12:00:00.000Z',
      });
    });

    it('should handle position beyond array length', async () => {
      await repository.addSermonToSeries('series-1', 'sermon-3', 10);

      expect(mockUpdate).toHaveBeenCalledWith({
        sermonIds: ['sermon-1', 'sermon-2', 'sermon-3'],
        updatedAt: '2024-01-01T12:00:00.000Z',
      });
    });

    it('should throw error when series not found', async () => {
      mockGet.mockResolvedValueOnce({
        exists: false,
        data: () => null,
      });

      await expect(repository.addSermonToSeries('non-existent', 'sermon-1')).rejects.toThrow('Series non-existent not found');
    });

    it('should throw error on Firestore error', async () => {
      const error = new Error('Firestore error');
      mockGet.mockRejectedValue(error);

      await expect(repository.addSermonToSeries('series-1', 'sermon-3')).rejects.toThrow('Firestore error');
    });
  });

  describe('removeSermonFromSeries', () => {
    it('should remove sermon from series', async () => {
      await repository.removeSermonFromSeries('series-1', 'sermon-1');

      expect(mockUpdate).toHaveBeenCalledWith({
        sermonIds: ['sermon-2'],
        updatedAt: '2024-01-01T12:00:00.000Z',
      });
    });

    it('should handle removing non-existent sermon', async () => {
      await repository.removeSermonFromSeries('series-1', 'non-existent');

      expect(mockUpdate).toHaveBeenCalledWith({
        sermonIds: ['sermon-1', 'sermon-2'], // unchanged
        updatedAt: '2024-01-01T12:00:00.000Z',
      });
    });

    it('should throw error when series not found', async () => {
      mockGet.mockResolvedValueOnce({
        exists: false,
        data: () => null,
      });

      await expect(repository.removeSermonFromSeries('non-existent', 'sermon-1')).rejects.toThrow('Series non-existent not found');
    });

    it('should throw error on Firestore error', async () => {
      const error = new Error('Firestore error');
      mockGet.mockRejectedValue(error);

      await expect(repository.removeSermonFromSeries('series-1', 'sermon-1')).rejects.toThrow('Firestore error');
    });
  });

  describe('reorderSermonsInSeries', () => {
    it('should reorder sermons successfully', async () => {
      const newOrder = ['sermon-2', 'sermon-1'];

      await repository.reorderSermonsInSeries('series-1', newOrder);

      expect(mockUpdate).toHaveBeenCalledWith({
        sermonIds: newOrder,
        updatedAt: '2024-01-01T12:00:00.000Z',
      });
    });

    it('should throw error for invalid sermonIds array', async () => {
      await expect(repository.reorderSermonsInSeries('series-1', ['sermon-1', 123 as any])).rejects.toThrow('Invalid sermonIds array');
    });

    it('should throw error for non-array sermonIds', async () => {
      await expect(repository.reorderSermonsInSeries('series-1', 'not-an-array' as any)).rejects.toThrow('Invalid sermonIds array');
    });

    it('should throw error on Firestore error', async () => {
      const error = new Error('Firestore error');
      mockUpdate.mockRejectedValue(error);

      await expect(repository.reorderSermonsInSeries('series-1', ['sermon-1'])).rejects.toThrow('Firestore error');
    });
  });
});
