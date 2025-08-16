import { sermonsRepository } from '@/api/repositories/sermons.repository';

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

    beforeEach(() => {
      // Mock successful document existence check
      mockDocSnap = {
        exists: true,
        data: () => ({ id: 'test-sermon', title: 'Test Sermon' })
      };
      mockGet.mockResolvedValue(mockDocSnap);
      mockUpdate.mockResolvedValue({});
    });

    it('should successfully update sermon plan with valid data', async () => {
      const result = await sermonsRepository.updateSermonPlan('test-sermon-123', validPlan);

      expect(mockUpdate).toHaveBeenCalledWith({ plan: validPlan });
      expect(result).toEqual(validPlan);
    });

    it('should throw error when plan is null', async () => {
      await expect(sermonsRepository.updateSermonPlan('test-sermon-123', null as any))
        .rejects.toThrow('Invalid plan data');
      
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should throw error when plan is undefined', async () => {
      await expect(sermonsRepository.updateSermonPlan('test-sermon-123', undefined as any))
        .rejects.toThrow('Invalid plan data');
      
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should throw error when plan is not an object', async () => {
      await expect(sermonsRepository.updateSermonPlan('test-sermon-123', 'not an object' as any))
        .rejects.toThrow('Invalid plan data');
      
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should throw error when plan is missing introduction section', async () => {
      const invalidPlan = {
        main: { outline: 'Main outline' },
        conclusion: { outline: 'Conclusion outline' }
      } as any; // Type assertion to bypass TypeScript for testing invalid cases

      await expect(sermonsRepository.updateSermonPlan('test-sermon-123', invalidPlan))
        .rejects.toThrow('Invalid plan structure');
      
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should throw error when plan is missing main section', async () => {
      const invalidPlan = {
        introduction: { outline: 'Introduction outline' },
        conclusion: { outline: 'Conclusion outline' }
      } as any; // Type assertion to bypass TypeScript for testing invalid cases

      await expect(sermonsRepository.updateSermonPlan('test-sermon-123', invalidPlan))
        .rejects.toThrow('Invalid plan structure');
      
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should throw error when plan is missing conclusion section', async () => {
      const invalidPlan = {
        introduction: { outline: 'Introduction outline' },
        main: { outline: 'Main outline' }
      } as any; // Type assertion to bypass TypeScript for testing invalid cases

      await expect(sermonsRepository.updateSermonPlan('test-sermon-123', invalidPlan))
        .rejects.toThrow('Invalid plan structure');
      
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should throw error when introduction.outline is not a string', async () => {
      const invalidPlan = {
        introduction: { outline: 123 as any }, // Type assertion to bypass TypeScript for testing invalid cases
        main: { outline: 'Main outline' },
        conclusion: { outline: 'Conclusion outline' }
      };

      await expect(sermonsRepository.updateSermonPlan('test-sermon-123', invalidPlan))
        .rejects.toThrow('Invalid plan structure - outline values must be strings');
      
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should throw error when main.outline is not a string', async () => {
      const invalidPlan = {
        introduction: { outline: 'Introduction outline' },
        main: { outline: true as any }, // Type assertion to bypass TypeScript for testing invalid cases
        conclusion: { outline: 'Conclusion outline' }
      };

      await expect(sermonsRepository.updateSermonPlan('test-sermon-123', invalidPlan))
        .rejects.toThrow('Invalid plan structure - outline values must be strings');
      
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should throw error when conclusion.outline is not a string', async () => {
      const invalidPlan = {
        introduction: { outline: 'Introduction outline' },
        main: { outline: 'Main outline' },
        conclusion: { outline: {} as any } // Type assertion to bypass TypeScript for testing invalid cases
      };

      await expect(sermonsRepository.updateSermonPlan('test-sermon-123', invalidPlan))
        .rejects.toThrow('Invalid plan structure - outline values must be strings');
      
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should throw error when introduction.outline is undefined', async () => {
      const invalidPlan = {
        introduction: { outline: undefined as any }, // Type assertion to bypass TypeScript for testing invalid cases
        main: { outline: 'Main outline' },
        conclusion: { outline: 'Conclusion outline' }
      };

      await expect(sermonsRepository.updateSermonPlan('test-sermon-123', invalidPlan))
        .rejects.toThrow('Invalid plan structure - outline values must be strings');
      
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should throw error when main.outline is null', async () => {
      const invalidPlan = {
        introduction: { outline: 'Introduction outline' },
        main: { outline: null as any }, // Type assertion to bypass TypeScript for testing invalid cases
        conclusion: { outline: 'Conclusion outline' }
      };

      await expect(sermonsRepository.updateSermonPlan('test-sermon-123', invalidPlan))
        .rejects.toThrow('Invalid plan structure - outline values must be strings');
      
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should accept empty string outline values', async () => {
      const planWithEmptyStrings = {
        introduction: { outline: '' },
        main: { outline: '' },
        conclusion: { outline: '' }
      };

      const result = await sermonsRepository.updateSermonPlan('test-sermon-123', planWithEmptyStrings);

      expect(mockUpdate).toHaveBeenCalledWith({ plan: planWithEmptyStrings });
      expect(result).toEqual(planWithEmptyStrings);
    });

    it('should handle Firestore errors', async () => {
      mockUpdate.mockRejectedValue(new Error('Firestore update failed'));

      await expect(sermonsRepository.updateSermonPlan('test-sermon-123', validPlan))
        .rejects.toThrow('Firestore update failed');
    });

    it('should handle sermon not found', async () => {
      mockDocSnap = {
        exists: false
      };
      mockGet.mockResolvedValue(mockDocSnap);

      await expect(sermonsRepository.updateSermonPlan('nonexistent-sermon', validPlan))
        .rejects.toThrow('Sermon not found');
      
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should handle Firestore get errors', async () => {
      mockGet.mockRejectedValue(new Error('Firestore get failed'));

      await expect(sermonsRepository.updateSermonPlan('test-sermon-123', validPlan))
        .rejects.toThrow('Firestore get failed');
      
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should validate plan structure with outlinePoints', async () => {
      const planWithOutlinePoints = {
        introduction: { 
          outline: 'Introduction outline',
          outlinePoints: { 'point1': 'content1' }
        },
        main: { 
          outline: 'Main outline',
          outlinePoints: { 'point2': 'content2' }
        },
        conclusion: { 
          outline: 'Conclusion outline',
          outlinePoints: { 'point3': 'content3' }
        }
      };

      const result = await sermonsRepository.updateSermonPlan('test-sermon-123', planWithOutlinePoints);

      expect(mockUpdate).toHaveBeenCalledWith({ plan: planWithOutlinePoints });
      expect(result).toEqual(planWithOutlinePoints);
    });
  });

  describe('fetchSermonById', () => {
    beforeEach(() => {
      mockDocSnap = {
        exists: true,
        data: () => ({
          id: 'test-sermon-123',
          title: 'Test Sermon',
          userId: 'user-123',
          verse: 'John 3:16',
          date: '2023-01-01'
        })
      };
      mockGet.mockResolvedValue(mockDocSnap);
    });

    it('should successfully fetch sermon by ID', async () => {
      const result = await sermonsRepository.fetchSermonById('test-sermon-123');

      expect(result).toEqual({
        id: 'test-sermon-123',
        title: 'Test Sermon',
        userId: 'user-123',
        verse: 'John 3:16',
        date: '2023-01-01'
      });
    });

    it('should throw error when sermon not found', async () => {
      mockDocSnap = {
        exists: false
      };
      mockGet.mockResolvedValue(mockDocSnap);

      await expect(sermonsRepository.fetchSermonById('nonexistent-sermon'))
        .rejects.toThrow('Sermon not found');
    });

    it('should handle Firestore errors', async () => {
      mockGet.mockRejectedValue(new Error('Firestore error'));

      await expect(sermonsRepository.fetchSermonById('test-sermon-123'))
        .rejects.toThrow('Firestore error');
    });
  });

  describe('deleteSermonById', () => {
    beforeEach(() => {
      mockDelete.mockResolvedValue({});
    });

    it('should successfully delete sermon by ID', async () => {
      await sermonsRepository.deleteSermonById('test-sermon-123');

      expect(mockDelete).toHaveBeenCalled();
    });

    it('should handle Firestore errors', async () => {
      mockDelete.mockRejectedValue(new Error('Firestore delete failed'));

      await expect(sermonsRepository.deleteSermonById('test-sermon-123'))
        .rejects.toThrow('Firestore delete failed');
    });
  });

  describe('updateSermonOutline', () => {
    const validOutline = {
      introduction: [{ id: '1', text: 'Point 1' }],
      main: [{ id: '2', text: 'Point 2' }],
      conclusion: [{ id: '3', text: 'Point 3' }]
    };

    beforeEach(() => {
      mockDocSnap = {
        exists: true,
        data: () => ({ id: 'test-sermon', title: 'Test Sermon' })
      };
      mockGet.mockResolvedValue(mockDocSnap);
      mockUpdate.mockResolvedValue({});
    });

    it('should successfully update sermon outline', async () => {
      const result = await sermonsRepository.updateSermonOutline('test-sermon-123', validOutline);

      expect(mockUpdate).toHaveBeenCalledWith({ outline: validOutline });
      expect(result).toEqual(validOutline);
    });

    it('should throw error when sermon not found', async () => {
      mockDocSnap = {
        exists: false
      };
      mockGet.mockResolvedValue(mockDocSnap);

      await expect(sermonsRepository.updateSermonOutline('nonexistent-sermon', validOutline))
        .rejects.toThrow('Sermon not found');
      
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should handle Firestore errors', async () => {
      mockUpdate.mockRejectedValue(new Error('Firestore update failed'));

      await expect(sermonsRepository.updateSermonOutline('test-sermon-123', validOutline))
        .rejects.toThrow('Firestore update failed');
    });
  });
}); 