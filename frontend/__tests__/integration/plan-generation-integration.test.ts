import { NextRequest } from 'next/server';

import { generatePlanForSection } from '@/api/clients/openAI.client';
import { GET } from '@/api/sermons/[id]/plan/route';
import { sermonsRepository } from '@/api/repositories/sermons.repository';

// Mock all dependencies
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

// Mock console methods
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

describe('Plan Generation Integration', () => {
  let mockRequest: NextRequest;
  let mockSermon: any;

  beforeEach(() => {
    jest.clearAllMocks();
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

    // Setup repository mock
    (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValue(mockSermon);
    (sermonsRepository.updateSermonContent as jest.Mock).mockResolvedValue({});

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
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('Complete Flow: AI Response to Database Storage', () => {
    it('should handle AI response with undefined values and prevent Firestore errors', async () => {
      // Mock AI response with undefined values (the original issue)
      const mockAIResponseWithUndefined = {
        plan: {
          introduction: { outline: undefined },
          main: { outline: null },
          conclusion: { outline: '' }
        },
        success: true
      };

      (generatePlanForSection as jest.Mock).mockResolvedValue(mockAIResponseWithUndefined);

      // Import and call the route handler      
      const response = await GET(mockRequest, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      // Verify that undefined/null values are converted to empty strings
      expect(sermonsRepository.updateSermonContent).toHaveBeenCalledWith(
        'test-sermon-123',
        expect.objectContaining({
          introduction: { outline: '' },
          main: { outline: '' },
          conclusion: { outline: '' }
        })
      );

      // Verify the response structure
      expect(responseData).toHaveProperty('introduction');
      expect(responseData).toHaveProperty('main');
      expect(responseData).toHaveProperty('conclusion');
      expect(responseData).toHaveProperty('sectionStatuses');
    });

    it('should handle AI response with mixed valid and invalid values', async () => {
      // Mock AI responses with mixed success/failure
      (generatePlanForSection as jest.Mock)
        .mockResolvedValueOnce({
          plan: { introduction: { outline: 'Valid introduction' } },
          success: true
        })
        .mockResolvedValueOnce({
          plan: { main: { outline: undefined } }, // Invalid
          success: true
        })
        .mockResolvedValueOnce({
          plan: { conclusion: { outline: 'Valid conclusion' } },
          success: true
        });      
      const response = await GET(mockRequest, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      await response.json();

      // Verify that the final plan sent to database has no undefined values
      expect(sermonsRepository.updateSermonContent).toHaveBeenCalledWith(
        'test-sermon-123',
        expect.objectContaining({
          introduction: { outline: 'Valid introduction' },
          main: { outline: '' }, // Should be converted to empty string
          conclusion: { outline: 'Valid conclusion' }
        })
      );
    });

    it('should handle AI response with non-string values', async () => {
      // Mock AI response with non-string values
      const mockAIResponseWithNonStrings = {
        plan: {
          introduction: { outline: 123 },
          main: { outline: true },
          conclusion: { outline: {} }
        },
        success: true
      };

      (generatePlanForSection as jest.Mock).mockResolvedValue(mockAIResponseWithNonStrings);      
      const response = await GET(mockRequest, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      await response.json();

      // Verify that non-string values are converted to empty strings
      expect(sermonsRepository.updateSermonContent).toHaveBeenCalledWith(
        'test-sermon-123',
        expect.objectContaining({
          introduction: { outline: '' },
          main: { outline: '' },
          conclusion: { outline: '' }
        })
      );
    });

    it('should handle repository validation errors gracefully', async () => {
      // Mock valid AI response
      const mockValidAIResponse = {
        plan: {
          introduction: { outline: 'Introduction' },
          main: { outline: 'Main' },
          conclusion: { outline: 'Conclusion' }
        },
        success: true
      };

      (generatePlanForSection as jest.Mock).mockResolvedValue(mockValidAIResponse);

      // Mock repository validation error
      (sermonsRepository.updateSermonContent as jest.Mock).mockRejectedValue(
        new Error('Invalid plan structure - outline values must be strings')
      );      
      const response = await GET(mockRequest, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      // Should still return the plan even if repository validation fails
      expect(responseData).toHaveProperty('introduction');
      expect(responseData).toHaveProperty('main');
      expect(responseData).toHaveProperty('conclusion');
    });

    it('should handle complete failure scenario', async () => {
      // Mock AI failure
      (generatePlanForSection as jest.Mock).mockRejectedValue(new Error('AI API failed'));      
      const response = await GET(mockRequest, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      // Should return error response
      expect(response.status).toBe(500);
      expect(responseData).toHaveProperty('error');
      expect(responseData.error).toBe('Failed to generate full plan');
    });

    it('should handle partial AI failures', async () => {
      // Mock mixed AI responses
      (generatePlanForSection as jest.Mock)
        .mockResolvedValueOnce({
          plan: { introduction: { outline: 'Introduction' } },
          success: true
        })
        .mockRejectedValueOnce(new Error('Main section failed'))
        .mockResolvedValueOnce({
          plan: { conclusion: { outline: 'Conclusion' } },
          success: true
        });      
      const response = await GET(mockRequest, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      // Should return 206 Partial Content
      expect(response.status).toBe(206);
      expect(responseData.introduction.outline).toBe('Introduction');
      expect(responseData.main.outline).toContain('Error generating main part');
      expect(responseData.conclusion.outline).toBe('Conclusion');
    });
  });

  describe('Repository Validation Integration', () => {
    it('should prevent undefined values from reaching Firestore', async () => {
      // Mock AI response with undefined values
      const mockAIResponseWithUndefined = {
        plan: {
          introduction: { outline: undefined },
          main: { outline: null },
          conclusion: { outline: '' }
        },
        success: true
      };

      (generatePlanForSection as jest.Mock).mockResolvedValue(mockAIResponseWithUndefined);      
      await GET(mockRequest, { params: Promise.resolve({ id: 'test-sermon-123' }) });

      // Verify that the repository receives valid data
      const updateCall = (sermonsRepository.updateSermonContent as jest.Mock).mock.calls[0];
      const planData = updateCall[1]; // Second argument is the plan data

      // Check that no undefined values exist in the plan
      expect(planData.introduction.outline).not.toBeUndefined();
      expect(planData.main.outline).not.toBeUndefined();
      expect(planData.conclusion.outline).not.toBeUndefined();

      // Check that all values are strings
      expect(typeof planData.introduction.outline).toBe('string');
      expect(typeof planData.main.outline).toBe('string');
      expect(typeof planData.conclusion.outline).toBe('string');
    });

    it('should handle repository validation errors', async () => {
      // Mock repository to throw validation error
      (sermonsRepository.updateSermonContent as jest.Mock).mockImplementation((_sermonId, plan) => {
        // Simulate the validation logic from the repository
        if (!plan || typeof plan !== 'object') {
          throw new Error('Invalid plan data');
        }
        if (!plan.introduction || !plan.main || !plan.conclusion) {
          throw new Error('Invalid plan structure');
        }
        if (typeof plan.introduction.outline !== 'string' || 
            typeof plan.main.outline !== 'string' || 
            typeof plan.conclusion.outline !== 'string') {
          throw new Error('Invalid plan structure - outline values must be strings');
        }
        return plan;
      });

      // Mock AI response with invalid data
      const mockAIResponseWithInvalidData = {
        plan: {
          introduction: { outline: 123 }, // Number instead of string
          main: { outline: 'Valid string' },
          conclusion: { outline: 'Valid string' }
        },
        success: true
      };

      (generatePlanForSection as jest.Mock).mockResolvedValue(mockAIResponseWithInvalidData);      
      const response = await GET(mockRequest, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      // Should still return a response even if repository validation fails
      expect(responseData).toHaveProperty('introduction');
      expect(responseData).toHaveProperty('main');
      expect(responseData).toHaveProperty('conclusion');
    });
  });

  describe('Error Recovery', () => {
    it('should recover from individual section failures', async () => {
      // Mock AI responses with one failure
      (generatePlanForSection as jest.Mock)
        .mockResolvedValueOnce({
          plan: { introduction: { outline: 'Introduction' } },
          success: true
        })
        .mockResolvedValueOnce({
          plan: { main: { outline: '' } },
          success: false
        })
        .mockResolvedValueOnce({
          plan: { conclusion: { outline: 'Conclusion' } },
          success: true
        });      
      const response = await GET(mockRequest, { params: Promise.resolve({ id: 'test-sermon-123' }) });

      // Should still save the plan with available sections
      expect(sermonsRepository.updateSermonContent).toHaveBeenCalledWith(
        'test-sermon-123',
        expect.objectContaining({
          introduction: { outline: 'Introduction' },
          main: { outline: '' },
          conclusion: { outline: 'Conclusion' }
        })
      );

      expect(response.status).toBe(206); // Partial Content
    });

    it('should handle complete AI failure gracefully', async () => {
      // Mock all AI calls to fail
      (generatePlanForSection as jest.Mock).mockRejectedValue(new Error('AI service unavailable'));      
      const response = await GET(mockRequest, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      // Should return error response
      expect(response.status).toBe(500);
      expect(responseData).toHaveProperty('error');
      expect(responseData.error).toBe('Failed to generate full plan');
    });
  });
}); 
