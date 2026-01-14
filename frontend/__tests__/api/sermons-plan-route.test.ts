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
    (sermonsRepository.updateSermonContent as jest.Mock).mockResolvedValue({});

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

  describe('GET /api/sermons/:id/plan (without section)', () => {
    it('should return 400 when section parameter is missing', async () => {
      const response = await GET(mockRequest, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      expect(response.status).toBe(400);
      expect(responseData).toHaveProperty('error');
      expect(responseData.error).toContain('Section parameter is required');
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

      const response = await GET(mockRequestWithSection, { params: Promise.resolve({ id: 'test-sermon-123' }) });
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

      const response = await GET(mockRequestWithInvalidSection, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      expect(response.status).toBe(400);
      expect(responseData).toHaveProperty('error');
      expect(responseData.error).toContain('Invalid section');
    });
  });
}); 
