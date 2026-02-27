import { sermonsRepository } from '@/api/repositories/sermons.repository';
import { adminDb, FieldValue } from '@/config/firebaseAdminConfig';

import { runScenarios } from '../../../test-utils/scenarioRunner';

jest.mock('@/config/firebaseAdminConfig', () => {
  const mockArrayUnion = jest.fn().mockImplementation((value: unknown) => ({
    __arrayUnion: value,
  }));
  const mockAdminDb = {
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
    FieldValue: { arrayUnion: mockArrayUnion },
  };
});

describe('SermonsRepository', () => {
  let mockDocRef: any;
  let mockDocSnap: any;
  let mockUpdate: jest.Mock;
  let mockGet: jest.Mock;
  let mockDelete: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup Firestore mocks
    mockUpdate = jest.fn();
    mockGet = jest.fn();
    mockDelete = jest.fn();

    mockDocRef = {
      get: mockGet,
      update: mockUpdate,
      delete: mockDelete
    };

    // Mock the collection().doc() chain
    const mockedAdminDb = adminDb as unknown as { collection: jest.Mock };
    mockedAdminDb.collection.mockReturnValue({
      doc: jest.fn().mockReturnValue(mockDocRef)
    });
  });

  describe('updateSermonPlan', () => {
    const validPlan = {
      introduction: { outline: 'Introduction outline' },
      main: { outline: 'Main outline' },
      conclusion: { outline: 'Conclusion outline' }
    };

    const seedSuccessfulDoc = () => {
      mockUpdate.mockReset();
      mockGet.mockReset();
      mockDocSnap = {
        exists: true,
        data: () => ({ id: 'test-sermon', title: 'Test Sermon' })
      };
      mockGet.mockResolvedValue(mockDocSnap);
      mockUpdate.mockResolvedValue({});
    };

    it('validates plan permutations with scenarios', async () => {
    const invalidPlanCases = [
        { name: 'plan is null', plan: null, error: 'Invalid content data' },
        { name: 'plan is undefined', plan: undefined, error: 'Invalid content data' },
        { name: 'plan is not object', plan: 'not an object', error: 'Invalid content data' },
        {
          name: 'missing introduction',
          plan: { main: { outline: 'Main outline' }, conclusion: { outline: 'Conclusion outline' } },
          error: 'Invalid content structure'
        },
        {
          name: 'missing main',
          plan: { introduction: { outline: 'Introduction outline' }, conclusion: { outline: 'Conclusion outline' } },
          error: 'Invalid content structure'
        },
        {
          name: 'missing conclusion',
          plan: { introduction: { outline: 'Introduction outline' }, main: { outline: 'Main outline' } },
          error: 'Invalid content structure'
        },
        {
          name: 'non-string introduction outline',
          plan: { introduction: { outline: 123 }, main: { outline: 'Main outline' }, conclusion: { outline: 'Conclusion outline' } },
          error: 'Invalid content structure - outline values must be strings'
        },
        {
          name: 'non-string main outline',
          plan: { introduction: { outline: 'Introduction outline' }, main: { outline: true }, conclusion: { outline: 'Conclusion outline' } },
          error: 'Invalid content structure - outline values must be strings'
        },
        {
          name: 'non-string conclusion outline',
          plan: { introduction: { outline: 'Introduction outline' }, main: { outline: 'Main outline' }, conclusion: { outline: {} } },
          error: 'Invalid content structure - outline values must be strings'
        },
        {
          name: 'undefined introduction outline',
          plan: { introduction: { outline: undefined }, main: { outline: 'Main outline' }, conclusion: { outline: 'Conclusion outline' } },
          error: 'Invalid content structure - outline values must be strings'
        },
        {
          name: 'null main outline',
          plan: { introduction: { outline: 'Introduction outline' }, main: { outline: null }, conclusion: { outline: 'Conclusion outline' } },
          error: 'Invalid content structure - outline values must be strings'
        }
      ];

      await runScenarios(
        [
          {
            name: 'successfully updates valid plan',
            run: async () => {
              const result = await sermonsRepository.updateSermonPlan('test-sermon-123', validPlan);
              expect(mockUpdate).toHaveBeenCalledWith({ draft: validPlan, plan: validPlan });
              expect(result).toEqual(validPlan);
            }
          },
          ...invalidPlanCases.map(({ name, plan, error }) => ({
            name,
            run: async () => {
              await expect(sermonsRepository.updateSermonPlan('test-sermon-123', plan as any)).rejects.toThrow(error);
              expect(mockUpdate).not.toHaveBeenCalled();
            }
          })),
          {
            name: 'accepts empty string outlines',
            run: async () => {
              const emptyPlan = {
                introduction: { outline: '' },
                main: { outline: '' },
                conclusion: { outline: '' }
              };
              const result = await sermonsRepository.updateSermonPlan('test-sermon-123', emptyPlan);
              expect(mockUpdate).toHaveBeenCalledWith({ draft: emptyPlan, plan: emptyPlan });
              expect(result).toEqual(emptyPlan);
            }
          },
          {
            name: 'accepts outlinePoints metadata',
            run: async () => {
              const planWithSermonPoints = {
                introduction: { outline: 'Introduction outline', outlinePoints: { point1: 'content1' } },
                main: { outline: 'Main outline', outlinePoints: { point2: 'content2' } },
                conclusion: { outline: 'Conclusion outline', outlinePoints: { point3: 'content3' } }
              };
              await sermonsRepository.updateSermonPlan('test-sermon-123', planWithSermonPoints);
              expect(mockUpdate).toHaveBeenCalledWith({ draft: planWithSermonPoints, plan: planWithSermonPoints });
            }
          },
          {
            name: 'handles Firestore update failure',
            run: async () => {
              mockUpdate.mockRejectedValue(new Error('Firestore update failed'));
              await expect(sermonsRepository.updateSermonPlan('test-sermon-123', validPlan)).rejects.toThrow('Firestore update failed');
            }
          },
          {
            name: 'handles sermon not found',
            run: async () => {
              mockDocSnap = { exists: false };
              mockGet.mockResolvedValue(mockDocSnap);
              await expect(sermonsRepository.updateSermonPlan('nonexistent-sermon', validPlan)).rejects.toThrow('Sermon not found');
              expect(mockUpdate).not.toHaveBeenCalled();
            }
          },
          {
            name: 'handles Firestore get failure',
            run: async () => {
              mockGet.mockRejectedValue(new Error('Firestore get failed'));
              await expect(sermonsRepository.updateSermonPlan('test-sermon-123', validPlan)).rejects.toThrow('Firestore get failed');
            }
          }
        ],
        { beforeEachScenario: seedSuccessfulDoc }
      );
    });
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

  describe('deleteSermonById', () => {
    beforeEach(() => {
      mockDelete.mockResolvedValue({});
    });

    it('handles delete outcomes', async () => {
      await runScenarios(
        [
          {
            name: 'deletes existing sermon',
            run: async () => {
              await sermonsRepository.deleteSermonById('test-sermon-123');
              expect(mockDelete).toHaveBeenCalled();
            }
          },
          {
            name: 'propagates Firestore delete errors',
            run: async () => {
              mockDelete.mockRejectedValue(new Error('Firestore delete failed'));
              await expect(sermonsRepository.deleteSermonById('test-sermon-123')).rejects.toThrow('Firestore delete failed');
            }
          }
        ],
        { beforeEachScenario: () => { mockDelete.mockResolvedValue({}); } }
      );
    });
  });

  describe('updateSermonOutline', () => {
    const validOutline = {
      introduction: [{ id: '1', text: 'Point 1' }],
      main: [{ id: '2', text: 'Point 2' }],
      conclusion: [{ id: '3', text: 'Point 3' }]
    };

    const seedOutlineSuccess = () => {
      mockDocSnap = {
        exists: true,
        data: () => ({ id: 'test-sermon', title: 'Test Sermon' })
      };
      mockGet.mockResolvedValue(mockDocSnap);
      mockUpdate.mockResolvedValue({});
    };

    it('covers outline update paths', async () => {
      await runScenarios(
        [
          {
            name: 'updates outline when sermon exists',
            run: async () => {
              const result = await sermonsRepository.updateSermonOutline('test-sermon-123', validOutline);
              expect(mockUpdate).toHaveBeenCalledWith({ outline: validOutline });
              expect(result).toEqual(validOutline);
            }
          },
          {
            name: 'throws when sermon missing',
            run: async () => {
              // Clear previous mock calls
              mockUpdate.mockClear();
              mockDocSnap = { exists: false };
              mockGet.mockResolvedValue(mockDocSnap);
              await expect(sermonsRepository.updateSermonOutline('nonexistent-sermon', validOutline)).rejects.toThrow('Sermon not found');
              expect(mockUpdate).not.toHaveBeenCalled();
            }
          },
          {
            name: 'propagates Firestore update failure',
            run: async () => {
              mockUpdate.mockRejectedValue(new Error('Firestore update failed'));
              await expect(sermonsRepository.updateSermonOutline('test-sermon-123', validOutline)).rejects.toThrow('Firestore update failed');
            }
          }
        ],
        { beforeEachScenario: seedOutlineSuccess }
      );
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

  describe('updateSermonSeriesInfo', () => {
    const seedExistingDoc = () => {
      mockDocSnap = {
        exists: true,
        data: () => ({ id: 'sermon-1', title: 'Test Sermon' }),
      };
      mockGet.mockResolvedValue(mockDocSnap);
      mockUpdate.mockResolvedValue({});
    };

    it('updates series linkage, treats null as valid, and no-ops when both fields are undefined', async () => {
      seedExistingDoc();

      await expect(
        sermonsRepository.updateSermonSeriesInfo('sermon-1', 'series-1', 2)
      ).resolves.toBeUndefined();
      expect(mockUpdate).toHaveBeenCalledWith({ seriesId: 'series-1', seriesPosition: 2 });

      mockUpdate.mockClear();
      await expect(
        sermonsRepository.updateSermonSeriesInfo('sermon-1', null, null)
      ).resolves.toBeUndefined();
      expect(mockUpdate).toHaveBeenCalledWith({ seriesId: null, seriesPosition: null });

      mockUpdate.mockClear();
      await expect(
        sermonsRepository.updateSermonSeriesInfo('sermon-1', undefined as any, undefined as any)
      ).resolves.toBeUndefined();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('throws when sermon is missing or firestore update fails', async () => {
      mockGet.mockResolvedValueOnce({ exists: false });
      await expect(
        sermonsRepository.updateSermonSeriesInfo('missing-sermon', 'series-1', 1)
      ).rejects.toThrow('Sermon not found');

      seedExistingDoc();
      mockUpdate.mockRejectedValueOnce(new Error('Firestore update failed'));
      await expect(
        sermonsRepository.updateSermonSeriesInfo('sermon-1', 'series-1', 1)
      ).rejects.toThrow('Firestore update failed');
    });
  });

  describe('preach dates repository methods', () => {
    it('addPreachDate normalizes date and defaults status to planned', async () => {
      mockUpdate.mockResolvedValueOnce(undefined);
      const originalCrypto = global.crypto;
      Object.defineProperty(global, 'crypto', {
        value: { randomUUID: jest.fn().mockReturnValue('uuid-1') },
        configurable: true,
      });

      try {
        const result = await sermonsRepository.addPreachDate('sermon-1', {
          date: '2026-02-15T16:00:00.000Z',
          church: { id: 'c1', name: 'Church 1' },
        });

        expect(FieldValue.arrayUnion).toHaveBeenCalledWith(
          expect.objectContaining({
            date: '2026-02-15',
            status: 'planned',
            church: expect.objectContaining({ name: 'Church 1' }),
          })
        );
        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            preachDates: expect.objectContaining({
              __arrayUnion: expect.objectContaining({ id: result.id }),
            }),
          }),
        );
        expect(result.date).toBe('2026-02-15');
        expect(result.status).toBe('planned');
      } finally {
        Object.defineProperty(global, 'crypto', {
          value: originalCrypto,
          configurable: true,
        });
      }
    });

    it('addPreachDate rejects invalid date format', async () => {
      await expect(
        sermonsRepository.addPreachDate('sermon-1', {
          date: 'bad-date',
          church: { id: 'c1', name: 'Church 1' },
        })
      ).rejects.toThrow('Invalid preach date format');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('updatePreachDate normalizes date and preserves id/createdAt', async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          preachDates: [
            {
              id: 'pd-1',
              date: '2026-02-01',
              status: 'planned',
              church: { id: 'c1', name: 'Church' },
              createdAt: '2026-02-01T00:00:00.000Z',
            },
          ],
        }),
      });
      mockUpdate.mockResolvedValueOnce(undefined);

      const result = await sermonsRepository.updatePreachDate('sermon-1', 'pd-1', {
        id: 'hack-id' as any,
        createdAt: 'hack-created-at' as any,
        date: '2026-02-20T10:20:00.000Z',
        status: 'preached',
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        preachDates: [
          expect.objectContaining({
            id: 'pd-1',
            createdAt: '2026-02-01T00:00:00.000Z',
            date: '2026-02-20',
            status: 'preached',
          }),
        ],
      });
      expect(result.id).toBe('pd-1');
      expect(result.createdAt).toBe('2026-02-01T00:00:00.000Z');
      expect(result.date).toBe('2026-02-20');
    });

    it('updatePreachDate rejects invalid update date', async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          preachDates: [
            {
              id: 'pd-1',
              date: '2026-02-01',
              church: { id: 'c1', name: 'Church' },
              createdAt: '2026-02-01T00:00:00.000Z',
            },
          ],
        }),
      });

      await expect(
        sermonsRepository.updatePreachDate('sermon-1', 'pd-1', { date: 'bad-date' })
      ).rejects.toThrow('Invalid preach date format');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('updatePreachDate throws when preach date id is missing', async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ preachDates: [] }),
      });

      await expect(
        sermonsRepository.updatePreachDate('sermon-1', 'missing-date', { status: 'planned' })
      ).rejects.toThrow('Preach date not found');
    });

    it('updatePreachDate throws when sermon does not exist', async () => {
      mockGet.mockResolvedValueOnce({ exists: false });

      await expect(
        sermonsRepository.updatePreachDate('missing-sermon', 'pd-1', { status: 'planned' })
      ).rejects.toThrow('Sermon not found');
    });

    it('deletePreachDate removes only the requested date and handles failures', async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          preachDates: [
            { id: 'pd-1', date: '2026-02-01', church: { id: 'c1', name: 'Church' }, createdAt: 'x' },
            { id: 'pd-2', date: '2026-02-02', church: { id: 'c2', name: 'Church 2' }, createdAt: 'y' },
          ],
        }),
      });
      mockUpdate.mockResolvedValueOnce(undefined);

      await expect(
        sermonsRepository.deletePreachDate('sermon-1', 'pd-1')
      ).resolves.toBeUndefined();
      expect(mockUpdate).toHaveBeenCalledWith({
        preachDates: [
          { id: 'pd-2', date: '2026-02-02', church: { id: 'c2', name: 'Church 2' }, createdAt: 'y' },
        ],
      });

      mockGet.mockResolvedValueOnce({ exists: false });
      await expect(
        sermonsRepository.deletePreachDate('missing-sermon', 'pd-1')
      ).rejects.toThrow('Sermon not found');

      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          preachDates: [
            { id: 'pd-1', date: '2026-02-01', church: { id: 'c1', name: 'Church' }, createdAt: 'x' },
          ],
        }),
      });
      mockUpdate.mockRejectedValueOnce(new Error('Firestore update failed'));
      await expect(
        sermonsRepository.deletePreachDate('sermon-1', 'pd-1')
      ).rejects.toThrow('Firestore update failed');
    });

    it('fetchSermonsWithPreachDates filters using normalized date-only boundaries', async () => {
      const mockQueryGet = jest.fn().mockResolvedValue({
        docs: [
          {
            id: 's-in-range',
            data: () => ({
              userId: 'user-1',
              preachDates: [
                { id: 'd1', date: '2026-02-16T10:00:00.000Z', church: { id: 'c1', name: 'Church' }, createdAt: 'x' },
              ],
            }),
          },
          {
            id: 's-out-of-range',
            data: () => ({
              userId: 'user-1',
              preachDates: [
                { id: 'd2', date: '2026-03-20', church: { id: 'c1', name: 'Church' }, createdAt: 'x' },
              ],
            }),
          },
          {
            id: 's-invalid-date',
            data: () => ({
              userId: 'user-1',
              preachDates: [
                { id: 'd3', date: 'not-a-date', church: { id: 'c1', name: 'Church' }, createdAt: 'x' },
              ],
            }),
          },
        ],
      });

      const mockedAdminDb = adminDb as unknown as { collection: jest.Mock };
      mockedAdminDb.collection.mockReturnValue({
        where: jest.fn().mockReturnValue({ get: mockQueryGet }),
      });

      const result = await sermonsRepository.fetchSermonsWithPreachDates(
        'user-1',
        '2026-02-15T00:00:00.000Z',
        '2026-02-20'
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('s-in-range');
    });

    it('fetchSermonsWithPreachDates hydrates aliases without filters and propagates query errors', async () => {
      const mockQueryGet = jest
        .fn()
        .mockResolvedValueOnce({
          docs: [
            {
              id: 'legacy-sermon',
              data: () => ({
                userId: 'user-1',
                structure: {
                  introduction: ['intro'],
                  main: ['main'],
                  conclusion: ['conclusion'],
                },
                plan: {
                  introduction: { outline: 'Intro' },
                  main: { outline: 'Main' },
                  conclusion: { outline: 'Conclusion' },
                },
                preachDates: [
                  { id: 'pd-1', date: '2026-02-18', church: { id: 'c1', name: 'Church' }, createdAt: 'x' },
                ],
              }),
            },
            {
              id: 'plain-sermon',
              data: () => ({
                userId: 'user-1',
                preachDates: [],
              }),
            },
          ],
        })
        .mockRejectedValueOnce(new Error('Firestore query failed'));

      const mockedAdminDb = adminDb as unknown as { collection: jest.Mock };
      mockedAdminDb.collection.mockReturnValue({
        where: jest.fn().mockReturnValue({ get: mockQueryGet }),
      });

      const result = await sermonsRepository.fetchSermonsWithPreachDates('user-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 'legacy-sermon',
          thoughtsBySection: {
            introduction: ['intro'],
            main: ['main'],
            conclusion: ['conclusion'],
          },
          structure: {
            introduction: ['intro'],
            main: ['main'],
            conclusion: ['conclusion'],
          },
          draft: {
            introduction: { outline: 'Intro' },
            main: { outline: 'Main' },
            conclusion: { outline: 'Conclusion' },
          },
          plan: {
            introduction: { outline: 'Intro' },
            main: { outline: 'Main' },
            conclusion: { outline: 'Conclusion' },
          },
        })
      );

      await expect(
        sermonsRepository.fetchSermonsWithPreachDates('user-1')
      ).rejects.toThrow('Firestore query failed');
    });
  });
});
