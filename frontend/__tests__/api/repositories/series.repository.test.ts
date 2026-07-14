import { SeriesRepository } from '@/api/repositories/series.repository';

// Mock Firestore
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
    batch: jest.fn(),
  },
}));

const { adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminDb: {
    collection: jest.Mock<unknown, unknown[]>;
    batch: jest.Mock<unknown, unknown[]>;
  };
};

const mockCollection = adminDb.collection;

const mockDocumentSnapshot = {
  exists: true,
  id: 'series-1',
  data: () => ({ ...mockSeriesData }),
};

const setupFirestoreMocks = () => {
  mockCollection.mockReturnValue({
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

  describe('deleteSermonAndDetachFromAllSeries', () => {
    it('atomically detaches owned series and deletes the sermon in ONE batch, skipping foreign series', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const batchUpdate = jest.fn();
      const batchDelete = jest.fn();
      const batchCommit = jest.fn().mockResolvedValue(undefined);
      (adminDb.batch as jest.Mock).mockReturnValue({ update: batchUpdate, delete: batchDelete, commit: batchCommit });

      const ownedRef = { id: 'series-owned' };
      const foreignRef = { id: 'series-foreign' };
      const sermonRef = { id: 'sermon-1' };

      (mockCollection as jest.Mock).mockImplementation((name: string) => {
        if (name === 'sermons') {
          return { doc: jest.fn().mockReturnValue(sermonRef) };
        }
        return {
          where: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
              docs: [
                { id: 'series-owned', ref: ownedRef, data: () => ({ ...mockSeriesData, userId: 'user-1', sermonIds: ['sermon-1'], items: [{ type: 'sermon', refId: 'sermon-1' }] }) },
                { id: 'series-foreign', ref: foreignRef, data: () => ({ ...mockSeriesData, userId: 'attacker', sermonIds: ['sermon-1'], items: [{ type: 'sermon', refId: 'sermon-1' }] }) },
              ],
            }),
          }),
        };
      });

      await repository.deleteSermonAndDetachFromAllSeries('sermon-1', 'user-1');

      // Only the owner's series is detached; the foreign-owned series is never touched.
      expect(batchUpdate).toHaveBeenCalledTimes(1);
      expect(batchUpdate).toHaveBeenCalledWith(
        ownedRef,
        expect.objectContaining({ sermonIds: expect.not.arrayContaining(['sermon-1']) })
      );
      // The sermon is deleted in the SAME batch — one atomic commit, all-or-nothing.
      expect(batchDelete).toHaveBeenCalledWith(sermonRef);
      expect(batchCommit).toHaveBeenCalledTimes(1);
      logSpy.mockRestore();
    });
  });

  describe('removeSermonFromAllSeries', () => {
    it('should return early when no series contain the sermon', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      mockWhere.mockReturnValue({
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      });

      await repository.removeSermonFromAllSeries('sermon-1', 'user-1');

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
          data: () => ({ ...mockSeriesData, userId: 'other-user', sermonIds: ['sermon-1'] }),
          ref: { update: docUpdate },
        },
      ];

      mockWhere.mockReturnValue({
        get: jest.fn().mockResolvedValue({ empty: false, docs }),
      });

      await repository.removeSermonFromAllSeries('sermon-1', 'user-1');

      expect(docUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({
        sermonIds: ['sermon-2'],
        updatedAt: '2024-01-01T12:00:00.000Z',
        seriesKind: 'sermon',
      }));
      expect(docUpdate).toHaveBeenCalledTimes(1);
      logSpy.mockRestore();
    });

    it('should throw error when Firestore query fails', async () => {
      const error = new Error('Firestore error');
      mockWhere.mockReturnValue({
        get: jest.fn().mockRejectedValue(error),
      });

      await expect(repository.removeSermonFromAllSeries('sermon-1', 'user-1')).rejects.toThrow('Firestore error');
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

      await repository.removeGroupFromAllSeries('group-1', 'user-1');
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
          {
            id: 'foreign-series',
            data: () => ({
              ...mockSeriesData,
              userId: 'other-user',
              items: [{ id: 'foreign-item', type: 'group', refId: 'group-1', position: 1 }],
            }),
            ref: { update: refUpdate },
          },
        ],
      });

      await repository.removeGroupFromAllSeries('group-1', 'user-1');

      expect(refUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ type: 'sermon', refId: 'sermon-1' })]),
          sermonIds: ['sermon-1'],
          seriesKind: 'sermon',
          updatedAt: '2024-01-01T12:00:00.000Z',
        })
      );
      expect(refUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
