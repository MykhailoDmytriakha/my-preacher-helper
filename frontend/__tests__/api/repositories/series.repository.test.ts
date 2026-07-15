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
    runTransaction: jest.fn(),
  },
}));

const { adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminDb: {
    collection: jest.Mock<unknown, unknown[]>;
    batch: jest.Mock<unknown, unknown[]>;
    runTransaction: jest.Mock;
  };
};

const mockCollection = adminDb.collection;

const mockDocumentSnapshot = {
  exists: true,
  id: 'series-1',
  data: () => ({ ...mockSeriesData }),
};

const guardTransactionReadOrder = (transaction: any) => {
  let hasWritten = false;
  const guardWrite = (method: 'set' | 'update' | 'delete') => (...args: any[]) => {
    hasWritten = true;
    return transaction[method](...args);
  };

  return {
    ...transaction,
    get: (...args: any[]) => {
      if (hasWritten) {
        throw new Error('Firestore transactions require all reads to be executed before all writes');
      }
      return transaction.get(...args);
    },
    ...(transaction.set && { set: guardWrite('set') }),
    ...(transaction.update && { update: guardWrite('update') }),
    ...(transaction.delete && { delete: guardWrite('delete') }),
  };
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
  adminDb.runTransaction.mockImplementation(async (callback: (transaction: any) => Promise<unknown>) => callback(guardTransactionReadOrder({
    get: (source: { get: () => Promise<unknown> }) => source.get(),
    update: (ref: { update: (...args: unknown[]) => unknown }, ...args: unknown[]) => ref.update(...args),
    delete: (ref: { delete: () => unknown }) => ref.delete(),
  })));
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
    it('retries from a concurrent same-owner edit and atomically detaches before deleting the sermon', async () => {
      const ownedRef = { id: 'series-owned' };
      const foreignRef = { id: 'series-foreign' };
      const sermonRef = { id: 'sermon-1' };
      const liveOwned: any = {
        ...mockSeriesData,
        userId: 'user-1',
        sermonIds: ['sermon-1'],
        items: [{ id: 'target', type: 'sermon', refId: 'sermon-1', position: 1 }],
      };
      const liveForeign = {
        ...mockSeriesData,
        userId: 'attacker',
        sermonIds: ['sermon-1'],
        items: [{ id: 'foreign-target', type: 'sermon', refId: 'sermon-1', position: 1 }],
      };
      let sermonExists = true;
      const query = { kind: 'sermon-query' };

      (mockCollection as jest.Mock).mockImplementation((name: string) => {
        if (name === 'sermons') {
          return { doc: jest.fn().mockReturnValue(sermonRef) };
        }
        return {
          where: jest.fn().mockReturnValue(query),
        };
      });
      adminDb.runTransaction.mockImplementationOnce(async (callback: (transaction: any) => Promise<unknown>) => {
        const runAttempt = async (commit: boolean) => {
          const staged: Array<() => void> = [];
          const result = await callback(guardTransactionReadOrder({
            get: jest.fn(async (source) => {
              expect(source).toBe(query);
              return {
                docs: [
                  { id: 'series-owned', ref: ownedRef, data: () => ({ ...liveOwned, items: [...liveOwned.items], sermonIds: [...liveOwned.sermonIds] }) },
                  { id: 'series-foreign', ref: foreignRef, data: () => ({ ...liveForeign }) },
                ],
              };
            }),
            update: jest.fn((ref, value) => staged.push(() => {
              if (ref === ownedRef) Object.assign(liveOwned, value);
              if (ref === foreignRef) throw new Error('foreign series must not be staged');
            })),
            delete: jest.fn((ref) => staged.push(() => {
              if (ref === sermonRef) sermonExists = false;
            })),
          }));
          if (commit) staged.forEach((write) => write());
          return result;
        };

        await runAttempt(false);
        liveOwned.items.push({ id: 'concurrent', type: 'sermon', refId: 'sermon-2', position: 2 });
        liveOwned.sermonIds.push('sermon-2');
        return runAttempt(true);
      });

      await repository.deleteSermonAndDetachFromAllSeries('sermon-1', 'user-1');

      expect(liveOwned.sermonIds).toEqual(['sermon-2']);
      expect(liveOwned.items).toEqual([expect.objectContaining({ refId: 'sermon-2' })]);
      expect(liveForeign.sermonIds).toEqual(['sermon-1']);
      expect(sermonExists).toBe(false);
    });

    it('leaves every series and the sermon unchanged when the transaction commit fails', async () => {
      const ownedRef = { id: 'series-owned' };
      const sermonRef = { id: 'sermon-1' };
      const liveItems = [{ id: 'target', type: 'sermon', refId: 'sermon-1', position: 1 }];
      const query = { kind: 'sermon-query' };
      (mockCollection as jest.Mock).mockImplementation((name: string) => name === 'sermons'
        ? { doc: jest.fn().mockReturnValue(sermonRef) }
        : { where: jest.fn().mockReturnValue(query) });
      adminDb.runTransaction.mockImplementationOnce(async (callback: (transaction: any) => Promise<unknown>) => {
        await callback(guardTransactionReadOrder({
          get: jest.fn().mockResolvedValue({ docs: [{ id: 'series-owned', ref: ownedRef, data: () => ({ ...mockSeriesData, items: liveItems }) }] }),
          update: jest.fn(),
          delete: jest.fn(),
        }));
        throw new Error('transaction commit failed');
      });

      await expect(repository.deleteSermonAndDetachFromAllSeries('sermon-1', 'user-1'))
        .rejects.toThrow('transaction commit failed');
      expect(liveItems).toEqual([{ id: 'target', type: 'sermon', refId: 'sermon-1', position: 1 }]);
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

    it('retries from a concurrent same-owner edit without clobbering the new series item', async () => {
      const seriesRef = { id: 'series-1' };
      const liveSeries: any = {
        ...mockSeriesData,
        items: [
          { id: 'group', type: 'group', refId: 'group-1', position: 1 },
          { id: 'sermon-1', type: 'sermon', refId: 'sermon-1', position: 2 },
        ],
        sermonIds: ['sermon-1'],
      };
      const query = { kind: 'owner-query' };
      const where = jest.fn().mockReturnValue(query);
      (mockCollection as jest.Mock).mockReturnValue({ where });
      adminDb.runTransaction.mockImplementationOnce(async (callback: (transaction: any) => Promise<unknown>) => {
        const runAttempt = async (commit: boolean) => {
          const staged: Array<() => void> = [];
          const result = await callback(guardTransactionReadOrder({
            get: jest.fn(async () => ({
              docs: [{ id: 'series-1', ref: seriesRef, data: () => ({ ...liveSeries, items: [...liveSeries.items], sermonIds: [...liveSeries.sermonIds] }) }],
            })),
            update: jest.fn((_ref, value) => staged.push(() => Object.assign(liveSeries, value))),
          }));
          if (commit) staged.forEach((write) => write());
          return result;
        };

        await runAttempt(false);
        liveSeries.items.push({ id: 'sermon-2', type: 'sermon', refId: 'sermon-2', position: 3 });
        liveSeries.sermonIds.push('sermon-2');
        return runAttempt(true);
      });

      await repository.removeGroupFromAllSeries('group-1', 'user-1');

      expect(where).toHaveBeenCalledWith('userId', '==', 'user-1');
      expect(liveSeries.sermonIds).toEqual(['sermon-1', 'sermon-2']);
      expect(liveSeries.items).toEqual([
        expect.objectContaining({ refId: 'sermon-1' }),
        expect.objectContaining({ refId: 'sermon-2' }),
      ]);
    });

    it('leaves matching series unchanged when the group-removal transaction fails', async () => {
      const liveItems = [{ id: 'group', type: 'group', refId: 'group-1', position: 1 }];
      (mockCollection as jest.Mock).mockReturnValue({ where: jest.fn().mockReturnValue({ kind: 'owner-query' }) });
      adminDb.runTransaction.mockImplementationOnce(async (callback: (transaction: any) => Promise<unknown>) => {
        await callback(guardTransactionReadOrder({
          get: jest.fn().mockResolvedValue({
            docs: [{ id: 'series-1', ref: { id: 'series-1' }, data: () => ({ ...mockSeriesData, items: liveItems }) }],
          }),
          update: jest.fn(),
        }));
        throw new Error('transaction commit failed');
      });

      await expect(repository.removeGroupFromAllSeries('group-1', 'user-1'))
        .rejects.toThrow('transaction commit failed');
      expect(liveItems).toEqual([{ id: 'group', type: 'group', refId: 'group-1', position: 1 }]);
    });
  });
});
