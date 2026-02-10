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
    get: mockGet,
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
      expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
        ...mockSeries,
        createdAt: '2024-01-01T12:00:00.000Z',
        updatedAt: '2024-01-01T12:00:00.000Z',
        seriesKind: 'sermon',
        sermonIds: ['sermon-1', 'sermon-2'],
      }));
      const createPayload = mockAdd.mock.calls[0][0] as { items?: unknown[] };
      expect(Array.isArray(createPayload.items)).toBe(true);
      expect(createPayload.items).toHaveLength(2);

      expect(result).toEqual(expect.objectContaining({
        ...mockSeries,
        id: 'new-series-id',
        createdAt: '2024-01-01T12:00:00.000Z',
        updatedAt: '2024-01-01T12:00:00.000Z',
        seriesKind: 'sermon',
        sermonIds: ['sermon-1', 'sermon-2'],
      }));
      expect(result.items).toHaveLength(2);
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

  describe('removeSermonFromAllSeries', () => {
    it('should return early when no series contain the sermon', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      mockWhere.mockReturnValue({
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      });

      await repository.removeSermonFromAllSeries('sermon-1');

      expect(mockWhere).toHaveBeenCalledWith('sermonIds', 'array-contains', 'sermon-1');
      expect(mockUpdate).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });

    it('should remove sermon id from matching series', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const docUpdate = jest.fn().mockResolvedValue(undefined);
      const docs = [
        {
          id: 'series-1',
          data: () => ({ ...mockSeriesData, sermonIds: ['sermon-1', 'sermon-2'] }),
          ref: { update: docUpdate },
        },
        {
          id: 'series-2',
          data: () => ({ ...mockSeriesData, sermonIds: ['sermon-1'] }),
          ref: { update: docUpdate },
        },
      ];

      mockWhere.mockReturnValue({
        get: jest.fn().mockResolvedValue({ empty: false, docs }),
      });

      await repository.removeSermonFromAllSeries('sermon-1');

      expect(docUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({
        sermonIds: ['sermon-2'],
        updatedAt: '2024-01-01T12:00:00.000Z',
        seriesKind: 'sermon',
      }));
      expect(docUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({
        sermonIds: [],
        updatedAt: '2024-01-01T12:00:00.000Z',
        seriesKind: 'sermon',
      }));
      logSpy.mockRestore();
    });

    it('should throw error when Firestore query fails', async () => {
      const error = new Error('Firestore error');
      mockWhere.mockReturnValue({
        get: jest.fn().mockRejectedValue(error),
      });

      await expect(repository.removeSermonFromAllSeries('sermon-1')).rejects.toThrow('Firestore error');
    });
  });

  describe('fetchSeriesById', () => {
    it('should fetch series by id successfully', async () => {
      const result = await repository.fetchSeriesById('series-1');

      expect(mockCollection).toHaveBeenCalledWith('series');
      expect(mockDoc).toHaveBeenCalledWith('series-1');
      expect(result).toEqual(expect.objectContaining({
        id: 'series-1',
        ...mockSeriesDoc.data(),
        seriesKind: 'sermon',
      }));
      expect(result?.items).toHaveLength(2);
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

    it('should update mixed items and derived fields when item-level updates are provided', async () => {
      const updates = {
        items: [
          { id: 'item-group', type: 'group', refId: 'group-1', position: 1 },
          { id: 'item-sermon', type: 'sermon', refId: 'sermon-2', position: 2 },
        ],
      } as any;

      await repository.updateSeries('series-1', updates);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ type: 'group', refId: 'group-1' }),
            expect.objectContaining({ type: 'sermon', refId: 'sermon-2' }),
          ]),
          sermonIds: ['sermon-2'],
          seriesKind: 'mixed',
        })
      );
    });

    it('should throw explicit error when updating non-existing series', async () => {
      mockGet.mockResolvedValueOnce({
        exists: false,
        id: 'missing',
        data: () => null,
      });

      await expect(repository.updateSeries('missing', { title: 'Updated' })).rejects.toThrow(
        'Series missing not found'
      );
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

      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        sermonIds: ['sermon-1', 'sermon-2', 'sermon-3'],
        updatedAt: '2024-01-01T12:00:00.000Z',
        seriesKind: 'sermon',
      }));
    });

    it('should add sermon at specific position', async () => {
      await repository.addSermonToSeries('series-1', 'sermon-3', 1);

      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        sermonIds: ['sermon-1', 'sermon-3', 'sermon-2'],
        updatedAt: '2024-01-01T12:00:00.000Z',
        seriesKind: 'sermon',
      }));
    });

    it('should move existing sermon to new position', async () => {
      await repository.addSermonToSeries('series-1', 'sermon-1', 1);

      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        sermonIds: ['sermon-2', 'sermon-1'],
        updatedAt: '2024-01-01T12:00:00.000Z',
        seriesKind: 'sermon',
      }));
    });

    it('should handle position beyond array length', async () => {
      await repository.addSermonToSeries('series-1', 'sermon-3', 10);

      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        sermonIds: ['sermon-1', 'sermon-2', 'sermon-3'],
        updatedAt: '2024-01-01T12:00:00.000Z',
        seriesKind: 'sermon',
      }));
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

      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        sermonIds: ['sermon-2'],
        updatedAt: '2024-01-01T12:00:00.000Z',
        seriesKind: 'sermon',
      }));
    });

    it('should handle removing non-existent sermon', async () => {
      await repository.removeSermonFromSeries('series-1', 'non-existent');

      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        sermonIds: ['sermon-1', 'sermon-2'], // unchanged
        updatedAt: '2024-01-01T12:00:00.000Z',
        seriesKind: 'sermon',
      }));
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

      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        sermonIds: newOrder,
        updatedAt: '2024-01-01T12:00:00.000Z',
        seriesKind: 'sermon',
      }));
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

  describe('mixed item management', () => {
    it('adds and removes group items in series', async () => {
      await repository.addGroupToSeries('series-1', 'group-1');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ type: 'group', refId: 'group-1' })]),
          seriesKind: 'mixed',
        })
      );

      await repository.removeGroupFromSeries('series-1', 'group-1');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.not.arrayContaining([expect.objectContaining({ type: 'group', refId: 'group-1' })]),
        })
      );
    });

    it('reorders mixed items by id', async () => {
      const mixedSeriesDoc = {
        exists: true,
        id: 'series-1',
        data: () => ({
          ...mockSeriesData,
          items: [
            { id: 'item-sermon-1', type: 'sermon', refId: 'sermon-1', position: 1 },
            { id: 'item-group-1', type: 'group', refId: 'group-1', position: 2 },
          ],
          sermonIds: ['sermon-1'],
          seriesKind: 'mixed',
        }),
      };
      mockGet.mockResolvedValueOnce(mixedSeriesDoc);

      await repository.reorderSeriesItems('series-1', ['item-group-1', 'item-sermon-1']);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ id: 'item-group-1', position: 1 }),
            expect.objectContaining({ id: 'item-sermon-1', position: 2 }),
          ]),
          sermonIds: ['sermon-1'],
          seriesKind: 'mixed',
        })
      );
    });

    it('throws on missing series in mixed operations', async () => {
      mockGet.mockResolvedValueOnce({ exists: false, data: () => null });
      await expect(repository.addGroupToSeries('missing', 'group-1')).rejects.toThrow('Series missing not found');

      mockGet.mockResolvedValueOnce({ exists: false, data: () => null });
      await expect(repository.removeGroupFromSeries('missing', 'group-1')).rejects.toThrow('Series missing not found');

      mockGet.mockResolvedValueOnce({ exists: false, data: () => null });
      await expect(repository.reorderSeriesItems('missing', ['item-1'])).rejects.toThrow('Series missing not found');
    });
  });

  describe('removeGroupFromAllSeries', () => {
    it('returns early when no series contain the group', async () => {
      mockGet.mockResolvedValueOnce({
        docs: [
          {
            id: 'series-1',
            data: () => ({ ...mockSeriesData, items: [] }),
            ref: { update: jest.fn() },
          },
        ],
      });

      await repository.removeGroupFromAllSeries('group-1');
      // no candidate update should run
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('removes group from all matching series', async () => {
      const refUpdate = jest.fn().mockResolvedValue(undefined);
      mockGet.mockResolvedValueOnce({
        docs: [
          {
            id: 'series-1',
            data: () => ({
              ...mockSeriesData,
              items: [
                { id: 'item-group', type: 'group', refId: 'group-1', position: 1 },
                { id: 'item-sermon', type: 'sermon', refId: 'sermon-1', position: 2 },
              ],
              sermonIds: ['sermon-1'],
              seriesKind: 'mixed',
            }),
            ref: { update: refUpdate },
          },
        ],
      });

      await repository.removeGroupFromAllSeries('group-1');

      expect(refUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ type: 'sermon', refId: 'sermon-1' })]),
          sermonIds: ['sermon-1'],
          seriesKind: 'sermon',
          updatedAt: '2024-01-01T12:00:00.000Z',
        })
      );
    });
  });
});
