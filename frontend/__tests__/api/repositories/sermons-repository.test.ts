import { sermonsRepository } from '@/api/repositories/sermons.repository';
import { adminDb } from '@/config/firebaseAdminConfig';

import { runScenarios } from '../../../test-utils/scenarioRunner';

jest.mock('@/config/firebaseAdminConfig', () => {
  const mockArrayUnion = jest.fn().mockImplementation((value: unknown) => ({
    __arrayUnion: value,
  }));
  const mockAdminDb = {
    runTransaction: jest.fn(),
    collection: jest.fn().mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      })
    })
  };

  return {
    adminDb: mockAdminDb,
    initAdmin: jest.fn().mockResolvedValue(mockAdminDb),
    FieldValue: {
      arrayUnion: mockArrayUnion,
      // Server writes advance the aggregate counter so it cannot lie to clients.
      increment: jest.fn((n: number) => ({ __increment: n })),
      serverTimestamp: jest.fn().mockReturnValue('mocked-server-timestamp')
    },
  };
});

describe('SermonsRepository', () => {
  let mockDocRef: any;
  let mockDocSnap: any;
  let mockUpdate: jest.Mock;
  let mockGet: jest.Mock;
  let mockDelete: jest.Mock;
  let mockTransactionSet: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup Firestore mocks
    mockUpdate = jest.fn();
    mockGet = jest.fn().mockResolvedValue({ exists: true, data: () => ({}) });
    mockDelete = jest.fn();
    mockTransactionSet = jest.fn();

    const mockOperationRef = {
      get: jest.fn().mockResolvedValue({ exists: false }),
      set: mockTransactionSet,
    };

    mockDocRef = {
      get: mockGet,
      update: mockUpdate,
      delete: mockDelete,
      collection: jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue(mockOperationRef),
      }),
    };

    // Mock the collection().doc() chain
    const mockedAdminDb = adminDb as unknown as { collection: jest.Mock };
    mockedAdminDb.collection.mockReturnValue({
      doc: jest.fn().mockReturnValue(mockDocRef)
    });
    (adminDb as unknown as { runTransaction: jest.Mock }).runTransaction.mockImplementation(
      async (callback: (transaction: any) => Promise<unknown>) => {
        const pendingWrites: Promise<unknown>[] = [];
        const result = await callback({
          get: (ref: { get: () => Promise<unknown> }) => ref.get(),
          update: (ref: { update: (value: unknown) => unknown }, value: unknown) => {
            pendingWrites.push(Promise.resolve(ref.update(value)));
          },
          delete: (ref: { delete: () => unknown }) => { pendingWrites.push(Promise.resolve(ref.delete())); },
          set: (ref: { set: (value: unknown) => unknown }, value: unknown) => {
            pendingWrites.push(Promise.resolve(ref.set(value)));
          },
        });
        await Promise.all(pendingWrites);
        return result;
      }
    );
  });

  describe('fetchSermonById', () => {
    const seedFetchSuccess = () => {
      mockDocSnap = {
        exists: true,
        id: 'test-sermon-123',
        data: () => ({
          id: 'test-sermon-123',
          title: 'Test Sermon',
          userId: 'user-123',
          verse: 'John 3:16',
          date: '2023-01-01'
        })
      };
      mockGet.mockResolvedValue(mockDocSnap);
    };

    it('covers fetch permutations', async () => {
      await runScenarios(
        [
          {
            name: 'returns sermon data when found',
            run: async () => {
              const result = await sermonsRepository.fetchSermonById('test-sermon-123');
              expect(result).toEqual({
                id: 'test-sermon-123',
                title: 'Test Sermon',
                userId: 'user-123',
                verse: 'John 3:16',
                date: '2023-01-01'
              });
            }
          },
          {
            name: 'throws when sermon missing',
            run: async () => {
              mockDocSnap = { exists: false };
              mockGet.mockResolvedValue(mockDocSnap);
              await expect(sermonsRepository.fetchSermonById('nonexistent-sermon')).rejects.toThrow('Sermon not found');
            }
          },
          {
            name: 'propagates Firestore errors',
            run: async () => {
              mockGet.mockRejectedValue(new Error('Firestore error'));
              await expect(sermonsRepository.fetchSermonById('test-sermon-123')).rejects.toThrow('Firestore error');
            }
          }
        ],
        { beforeEachScenario: seedFetchSuccess }
      );
    });

    it('hydrates legacy structure and plan aliases', async () => {
      mockDocSnap = {
        exists: true,
        id: 'legacy-sermon',
        data: () => ({
          title: 'Legacy Sermon',
          userId: 'user-123',
          verse: 'Romans 8:28',
          date: '2023-01-02',
          structure: {
            introduction: ['intro-thought'],
            main: ['main-thought'],
            conclusion: ['end-thought'],
          },
          plan: {
            introduction: { outline: 'Intro' },
            main: { outline: 'Main' },
            conclusion: { outline: 'Conclusion' },
          },
        })
      };
      mockGet.mockResolvedValue(mockDocSnap);

      const result = await sermonsRepository.fetchSermonById('legacy-sermon');

      expect(result.structure).toEqual({
        introduction: ['intro-thought'],
        main: ['main-thought'],
        conclusion: ['end-thought'],
      });
      expect(result.thoughtsBySection).toEqual(result.structure);
      expect(result.plan).toEqual({
        introduction: { outline: 'Intro' },
        main: { outline: 'Main' },
        conclusion: { outline: 'Conclusion' },
      });
      expect(result.draft).toEqual(result.plan);
    });
  });

  describe('fetchSermonOutlineBySermonId', () => {
    it('returns outline data or empty object and propagates errors', async () => {
      await runScenarios(
        [
          {
            name: 'returns the outline when present',
            run: async () => {
              mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                  outline: {
                    introduction: [{ id: 'p1', text: 'Intro point' }],
                    main: [],
                    conclusion: [],
                  },
                }),
              });

              const result = await sermonsRepository.fetchSermonOutlineBySermonId('sermon-1');

              expect(result).toEqual({
                introduction: [{ id: 'p1', text: 'Intro point' }],
                main: [],
                conclusion: [],
              });
            }
          },
          {
            name: 'returns empty object when outline is absent',
            run: async () => {
              mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({}),
              });

              const result = await sermonsRepository.fetchSermonOutlineBySermonId('sermon-1');

              expect(result).toEqual({});
            }
          },
          {
            name: 'throws when sermon is missing',
            run: async () => {
              mockGet.mockResolvedValueOnce({ exists: false });

              await expect(
                sermonsRepository.fetchSermonOutlineBySermonId('missing-sermon')
              ).rejects.toThrow('Sermon not found');
            }
          },
          {
            name: 'propagates firestore get errors',
            run: async () => {
              mockGet.mockRejectedValueOnce(new Error('Firestore get failed'));

              await expect(
                sermonsRepository.fetchSermonOutlineBySermonId('sermon-1')
              ).rejects.toThrow('Firestore get failed');
            }
          }
        ],
        { beforeEachScenario: () => { jest.clearAllMocks(); } }
      );
    });
  });

  describe('fetchAdjacentOutlinePoints', () => {
    const outline = {
      introduction: [
        { id: 'intro-1', text: 'Intro 1' },
        { id: 'intro-2', text: 'Intro 2' },
      ],
      main: [
        { id: 'main-1', text: 'Main 1' },
        { id: 'main-2', text: 'Main 2' },
        { id: 'main-3', text: 'Main 3' },
      ],
      conclusion: [
        { id: 'conclusion-1', text: 'Conclusion 1' },
      ],
    };

    it('returns adjacent points for introduction, main, and conclusion sections', async () => {
      const spy = jest.spyOn(sermonsRepository, 'fetchSermonById').mockResolvedValue({
        id: 'sermon-1',
        title: 'Test',
        verse: 'John 3:16',
        date: '2024-01-01',
        thoughts: [],
        userId: 'user-1',
        outline,
      } as any);

      try {
        await expect(
          sermonsRepository.fetchAdjacentOutlinePoints('sermon-1', 'intro-1')
        ).resolves.toEqual({
          previousPoint: null,
          nextPoint: { text: 'Intro 2' },
          section: 'introduction',
        });

        await expect(
          sermonsRepository.fetchAdjacentOutlinePoints('sermon-1', 'main-2')
        ).resolves.toEqual({
          previousPoint: { text: 'Main 1' },
          nextPoint: { text: 'Main 3' },
          section: 'main',
        });

        await expect(
          sermonsRepository.fetchAdjacentOutlinePoints('sermon-1', 'conclusion-1')
        ).resolves.toEqual({
          previousPoint: null,
          nextPoint: null,
          section: 'conclusion',
        });
      } finally {
        spy.mockRestore();
      }
    });

    it('returns null for missing points, missing outline, or fetch failures', async () => {
      const noOutlineSpy = jest.spyOn(sermonsRepository, 'fetchSermonById').mockResolvedValue({
        id: 'sermon-1',
        title: 'Test',
        verse: 'John 3:16',
        date: '2024-01-01',
        thoughts: [],
        userId: 'user-1',
      } as any);

      try {
        await expect(
          sermonsRepository.fetchAdjacentOutlinePoints('sermon-1', 'main-1')
        ).resolves.toBeNull();
      } finally {
        noOutlineSpy.mockRestore();
      }

      const missingPointSpy = jest.spyOn(sermonsRepository, 'fetchSermonById').mockResolvedValue({
        id: 'sermon-1',
        title: 'Test',
        verse: 'John 3:16',
        date: '2024-01-01',
        thoughts: [],
        userId: 'user-1',
        outline,
      } as any);

      try {
        await expect(
          sermonsRepository.fetchAdjacentOutlinePoints('sermon-1', 'unknown-point')
        ).resolves.toBeNull();
      } finally {
        missingPointSpy.mockRestore();
      }

      const errorSpy = jest.spyOn(sermonsRepository, 'fetchSermonById').mockRejectedValue(
        new Error('Firestore error')
      );

      try {
        await expect(
          sermonsRepository.fetchAdjacentOutlinePoints('sermon-1', 'main-1')
        ).resolves.toBeNull();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});
