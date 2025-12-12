import { sermonsRepository } from '@/api/repositories/sermons.repository';

import { runScenarios } from '../../../test-utils/scenarioRunner';

// Mock Firestore admin with proper module path
jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn().mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      })
    })
  }
}));

// Mock the firebaseAdminConfig initialization
jest.mock('@/config/firebaseAdminConfig', () => {
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
    initAdmin: jest.fn().mockResolvedValue(mockAdminDb)
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
    const { adminDb } = require('@/config/firebaseAdminConfig');
    adminDb.collection.mockReturnValue({
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
        { name: 'plan is null', plan: null, error: 'Invalid draft data' },
        { name: 'plan is undefined', plan: undefined, error: 'Invalid draft data' },
        { name: 'plan is not object', plan: 'not an object', error: 'Invalid draft data' },
        {
          name: 'missing introduction',
          plan: { main: { outline: 'Main outline' }, conclusion: { outline: 'Conclusion outline' } },
          error: 'Invalid draft structure'
        },
        {
          name: 'missing main',
          plan: { introduction: { outline: 'Introduction outline' }, conclusion: { outline: 'Conclusion outline' } },
          error: 'Invalid draft structure'
        },
        {
          name: 'missing conclusion',
          plan: { introduction: { outline: 'Introduction outline' }, main: { outline: 'Main outline' } },
          error: 'Invalid draft structure'
        },
        {
          name: 'non-string introduction outline',
          plan: { introduction: { outline: 123 }, main: { outline: 'Main outline' }, conclusion: { outline: 'Conclusion outline' } },
          error: 'Invalid draft structure - outline values must be strings'
        },
        {
          name: 'non-string main outline',
          plan: { introduction: { outline: 'Introduction outline' }, main: { outline: true }, conclusion: { outline: 'Conclusion outline' } },
          error: 'Invalid draft structure - outline values must be strings'
        },
        {
          name: 'non-string conclusion outline',
          plan: { introduction: { outline: 'Introduction outline' }, main: { outline: 'Main outline' }, conclusion: { outline: {} } },
          error: 'Invalid draft structure - outline values must be strings'
        },
        {
          name: 'undefined introduction outline',
          plan: { introduction: { outline: undefined }, main: { outline: 'Main outline' }, conclusion: { outline: 'Conclusion outline' } },
          error: 'Invalid draft structure - outline values must be strings'
        },
        {
          name: 'null main outline',
          plan: { introduction: { outline: 'Introduction outline' }, main: { outline: null }, conclusion: { outline: 'Conclusion outline' } },
          error: 'Invalid draft structure - outline values must be strings'
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
});
