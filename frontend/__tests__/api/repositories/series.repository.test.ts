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
      where: mockWhere, limit: jest.fn().mockReturnThis(),
      get: mockGet,
    }),
  });

  mockGet.mockResolvedValue(mockDocumentSnapshot);
  adminDb.runTransaction.mockImplementation(async (callback: (transaction: any) => Promise<unknown>) => {
    const pending: Promise<unknown>[] = [];
    const result = await callback(guardTransactionReadOrder({
      get: (source: { get: () => Promise<unknown> }) => source.get(),
      update: (ref: any, ...args: unknown[]) => { pending.push(Promise.resolve(ref.update(...args))); },
      delete: (ref: any) => { pending.push(Promise.resolve(ref.delete())); },
    }));
    await Promise.all(pending);
    return result;
  });
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
      const query = { kind: 'sermon-query', where: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis() };

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
              if (source === sermonRef) return { exists: true, ref: sermonRef, data: () => ({ userId: 'user-1' }) };
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
      // The detach is a membership change, so it must advance the membership
      // counter — otherwise an open series screen keeps stating a revision the
      // server no longer holds and its next save is granted permission to
      // overwrite this detach.
      expect(liveOwned['rev.items']).toEqual(expect.objectContaining({ operand: 1 }));
      expect(sermonExists).toBe(false);
    });

    it('leaves every series and the sermon unchanged when the transaction commit fails', async () => {
      const ownedRef = { id: 'series-owned' };
      const sermonRef = { id: 'sermon-1' };
      const liveItems = [{ id: 'target', type: 'sermon', refId: 'sermon-1', position: 1 }];
      const query = { kind: 'sermon-query', where: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis() };
      (mockCollection as jest.Mock).mockImplementation((name: string) => name === 'sermons'
        ? { doc: jest.fn().mockReturnValue(sermonRef) }
        : { where: jest.fn().mockReturnValue(query) });
      adminDb.runTransaction.mockImplementationOnce(async (callback: (transaction: any) => Promise<unknown>) => {
        await callback(guardTransactionReadOrder({
          get: jest.fn(async source => source === sermonRef ? { exists: true, ref: sermonRef, data: () => ({ userId: 'user-1' }) } : { docs: [{ id: 'series-owned', ref: ownedRef, data: () => ({ ...mockSeriesData, items: liveItems }) }] }),
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
});
