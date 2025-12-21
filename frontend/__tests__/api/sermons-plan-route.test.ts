import { NextRequest } from 'next/server';

import { generatePlanForSection } from '@/api/clients/openAI.client';
import { GET } from '@/api/sermons/[id]/plan/route';
import { sermonsRepository } from '@/api/repositories/sermons.repository';

// Mock dependencies
jest.mock('@/api/repositories/sermons.repository');
jest.mock('@/api/clients/openAI.client');
jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, options = {}) => ({
      status: options.status || 200,
      json: async () => data,
    })),
  },
}));

// Mock Firebase admin configuration
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

// Mock console methods to avoid noise in tests
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

describe('Sermon Plan Route', () => {
  let mockRequest: NextRequest;
  let mockSermon: any;
  let mockPlanResult: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Suppress console output during tests
    console.log = jest.fn();
    console.error = jest.fn();

    // Mock sermon data
    mockSermon = {
      id: 'test-sermon-123',
      title: 'Test Sermon',
      userId: 'user-123',
      verse: 'John 3:16',
      thoughts: [
        { id: '1', text: 'Thought 1', tags: [], date: '2023-01-01' },
        { id: '2', text: 'Thought 2', tags: [], date: '2023-01-01' }
      ],
      date: '2023-01-01'
    };

    // Mock plan result
    mockPlanResult = {
      plan: {
        introduction: { outline: 'Introduction outline' },
        main: { outline: 'Main outline' },
        conclusion: { outline: 'Conclusion outline' }
      },
      success: true
    };

    // Setup repository mock
    (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValue(mockSermon);
    (sermonsRepository.updateSermonPlan as jest.Mock).mockResolvedValue({});

    // Setup OpenAI client mock
    (generatePlanForSection as jest.Mock).mockResolvedValue(mockPlanResult);

    // Create mock request
    mockRequest = {
      nextUrl: {
        searchParams: {
          get: jest.fn().mockReturnValue(null)
        }
      }
    } as unknown as NextRequest;
  });

  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('GET /api/sermons/:id/plan', () => {
    it('should generate full plan successfully', async () => {
      const response = await GET(mockRequest, { params: { id: 'test-sermon-123' } });
      const responseData = await response.json();

      // Verify repository calls
      expect(sermonsRepository.fetchSermonById).toHaveBeenCalledWith('test-sermon-123');
      expect(sermonsRepository.updateSermonPlan).toHaveBeenCalledWith(
        'test-sermon-123',
        expect.objectContaining({
          introduction: { outline: 'Introduction outline' },
          main: { outline: 'Main outline' },
          conclusion: { outline: 'Conclusion outline' }
        })
      );

      // Verify OpenAI client calls
      expect(generatePlanForSection).toHaveBeenCalledTimes(3);
      expect(generatePlanForSection).toHaveBeenCalledWith(mockSermon, 'introduction');
      expect(generatePlanForSection).toHaveBeenCalledWith(mockSermon, 'main');
      expect(generatePlanForSection).toHaveBeenCalledWith(mockSermon, 'conclusion');

      // Verify response structure
      expect(responseData).toHaveProperty('introduction');
      expect(responseData).toHaveProperty('main');
      expect(responseData).toHaveProperty('conclusion');
      expect(responseData).toHaveProperty('sectionStatuses');
    });

    it('should handle undefined outline values from AI response', async () => {
      // Mock AI response with undefined values
      const mockUndefinedResult = {
        plan: {
          introduction: { outline: undefined },
          main: { outline: null },
          conclusion: { outline: '' }
        },
        success: true
      };
      (generatePlanForSection as jest.Mock).mockResolvedValue(mockUndefinedResult);

      const response = await GET(mockRequest, { params: { id: 'test-sermon-123' } });
      await response.json();

      // Verify that undefined/null values are converted to empty strings
      expect(sermonsRepository.updateSermonPlan).toHaveBeenCalledWith(
        'test-sermon-123',
        expect.objectContaining({
          introduction: { outline: '' },
          main: { outline: '' },
          conclusion: { outline: '' }
        })
      );
    });

    it('should handle AI response with invalid plan structure', async () => {
      // Mock AI response with invalid structure
      const mockInvalidResult = {
        plan: {
          introduction: { outline: 'Valid outline' },
          // Missing main and conclusion
        },
        success: true
      };
      (generatePlanForSection as jest.Mock).mockResolvedValue(mockInvalidResult);

      const response = await GET(mockRequest, { params: { id: 'test-sermon-123' } });
      await response.json();

      // Verify fallback plan is used
      expect(sermonsRepository.updateSermonPlan).toHaveBeenCalledWith(
        'test-sermon-123',
        expect.objectContaining({
          introduction: { outline: '' },
          main: { outline: '' },
          conclusion: { outline: '' }
        })
      );
    });

    it('should handle partial failures and return 206 status', async () => {
      // Mock mixed success/failure results
      (generatePlanForSection as jest.Mock)
        .mockResolvedValueOnce({ plan: { introduction: { outline: 'Intro' } }, success: true })
        .mockResolvedValueOnce({ plan: { main: { outline: '' } }, success: false })
        .mockResolvedValueOnce({ plan: { conclusion: { outline: 'Conclusion' } }, success: true });

      const response = await GET(mockRequest, { params: { id: 'test-sermon-123' } });

      // Verify 206 Partial Content status
      expect(response.status).toBe(206);
    });

    it('should handle repository errors gracefully', async () => {
      // Mock repository error
      (sermonsRepository.updateSermonPlan as jest.Mock).mockRejectedValue(
        new Error('Firestore error')
      );

      const response = await GET(mockRequest, { params: { id: 'test-sermon-123' } });
      const responseData = await response.json();

      // Should still return the plan even if saving fails
      expect(responseData).toHaveProperty('introduction');
      expect(responseData).toHaveProperty('main');
      expect(responseData).toHaveProperty('conclusion');
    });

    it('should handle sermon not found', async () => {
      // Mock sermon not found
      (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValue(null);

      const response = await GET(mockRequest, { params: { id: 'nonexistent-sermon' } });
      const responseData = await response.json();

      expect(response.status).toBe(404);
      expect(responseData).toHaveProperty('error', 'Sermon not found');
    });

    it('should validate plan structure before saving', async () => {
      // Mock AI response with non-string outline values
      const mockInvalidResult = {
        plan: {
          introduction: { outline: 123 }, // Number instead of string
          main: { outline: true }, // Boolean instead of string
          conclusion: { outline: {} } // Object instead of string
        },
        success: true
      };
      (generatePlanForSection as jest.Mock).mockResolvedValue(mockInvalidResult);

      await GET(mockRequest, { params: { id: 'test-sermon-123' } });

      // Verify that invalid types are converted to empty strings
      expect(sermonsRepository.updateSermonPlan).toHaveBeenCalledWith(
        'test-sermon-123',
        expect.objectContaining({
          introduction: { outline: '' },
          main: { outline: '' },
          conclusion: { outline: '' }
        })
      );
    });

    it('should handle individual section generation failures', async () => {
      // Mock individual section failures
      (generatePlanForSection as jest.Mock)
        .mockResolvedValueOnce({ plan: { introduction: { outline: 'Intro' } }, success: true })
        .mockRejectedValueOnce(new Error('Main section failed'))
        .mockResolvedValueOnce({ plan: { conclusion: { outline: 'Conclusion' } }, success: true });

      const response = await GET(mockRequest, { params: { id: 'test-sermon-123' } });
      const responseData = await response.json();

      // Verify error handling for individual sections
      expect(responseData.introduction.outline).toBe('Intro');
      expect(responseData.main.outline).toContain('Error generating main part');
      expect(responseData.conclusion.outline).toBe('Conclusion');
      expect(response.status).toBe(206); // Partial Content
    });
  });

  describe('GET /api/sermons/:id/plan?section=<section>', () => {
    it('should generate plan for specific section', async () => {
      // Reset the mock for this specific test
      (generatePlanForSection as jest.Mock).mockClear();
      (generatePlanForSection as jest.Mock).mockResolvedValue({
        plan: { 
          introduction: { outline: 'Introduction outline' },
          main: { outline: '' },
          conclusion: { outline: '' }
        },
        success: true
      });
      
      // Mock request with section parameter
      const mockRequestWithSection = {
        nextUrl: {
          searchParams: {
            get: jest.fn().mockImplementation((param) => {
              if (param === 'section') return 'introduction';
              return null;
            })
          }
        }
      } as unknown as NextRequest;

      const response = await GET(mockRequestWithSection, { params: { id: 'test-sermon-123' } });
      const responseData = await response.json();

      // Verify only one section was generated
      expect(generatePlanForSection).toHaveBeenCalledTimes(1);
      expect(generatePlanForSection).toHaveBeenCalledWith(mockSermon, 'introduction');

      // Verify response structure
      expect(responseData).toHaveProperty('introduction');
      expect(responseData).toHaveProperty('main');
      expect(responseData).toHaveProperty('conclusion');
    });

    it('should return 400 for invalid section parameter', async () => {
      // Mock request with invalid section
      const mockRequestWithInvalidSection = {
        nextUrl: {
          searchParams: {
            get: jest.fn().mockImplementation((param) => {
              if (param === 'section') return 'invalid-section';
              return null;
            })
          }
        }
      } as unknown as NextRequest;

      const response = await GET(mockRequestWithInvalidSection, { params: { id: 'test-sermon-123' } });
      const responseData = await response.json();

      expect(response.status).toBe(400);
      expect(responseData).toHaveProperty('error');
      expect(responseData.error).toContain('Invalid section');
    });
  });
}); 
