import { NextRequest } from 'next/server';

import { generatePlanForSection, generatePlanPointContent } from '@/api/clients/openAI.client';
import { GET, PUT } from '@/api/sermons/[id]/plan/route';
import { sermonsRepository } from '@/api/repositories/sermons.repository';
import { getThoughtsForOutlinePoint } from '@/utils/thoughtOrdering';

// Mock dependencies
jest.mock('@/api/repositories/sermons.repository');
jest.mock('@/api/clients/openAI.client');
jest.mock('@/utils/thoughtOrdering');
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
      outline: {
        introduction: [{ id: 'p1', text: 'Intro point' }],
        main: [{ id: 'p2', text: 'Main point' }],
        conclusion: [{ id: 'p3', text: 'Conclusion point' }],
      },
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
    (sermonsRepository.fetchAdjacentOutlinePoints as jest.Mock).mockResolvedValue({
      previousPoint: { text: 'Prev' },
      nextPoint: { text: 'Next' },
      section: 'introduction',
    });

    // Setup OpenAI client mock
    (generatePlanForSection as jest.Mock).mockResolvedValue(mockPlanResult);
    (generatePlanPointContent as jest.Mock).mockResolvedValue({ content: 'Outline content', success: true });

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

    it('should return 404 when sermon is not found', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValue(null);

      const mockRequestWithSection = {
        nextUrl: {
          searchParams: {
            get: jest.fn().mockImplementation((param) => {
              if (param === 'section') return 'main';
              return null;
            })
          }
        }
      } as unknown as NextRequest;

      const response = await GET(mockRequestWithSection, { params: Promise.resolve({ id: 'missing-sermon' }) });
      const responseData = await response.json();

      expect(response.status).toBe(404);
      expect(responseData).toHaveProperty('error');
    });

    it('should return 500 when plan generation fails', async () => {
      (generatePlanForSection as jest.Mock).mockResolvedValue({
        plan: { introduction: { outline: '' }, main: { outline: '' }, conclusion: { outline: '' } },
        success: false,
      });

      const mockRequestWithSection = {
        nextUrl: {
          searchParams: {
            get: jest.fn().mockImplementation((param) => {
              if (param === 'section') return 'conclusion';
              return null;
            })
          }
        }
      } as unknown as NextRequest;

      const response = await GET(mockRequestWithSection, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData).toHaveProperty('error');
    });

    it('should still return plan when save fails', async () => {
      (sermonsRepository.updateSermonContent as jest.Mock).mockRejectedValue(new Error('save failed'));

      const mockRequestWithSection = {
        nextUrl: {
          searchParams: {
            get: jest.fn().mockImplementation((param) => {
              if (param === 'section') return 'introduction';
              if (param === 'style') return 'memory';
              return null;
            })
          }
        }
      } as unknown as NextRequest;

      const response = await GET(mockRequestWithSection, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData).toHaveProperty('introduction');
    });

    it('should return 500 when generation throws', async () => {
      (generatePlanForSection as jest.Mock).mockRejectedValue(new Error('AI error'));

      const mockRequestWithSection = {
        nextUrl: {
          searchParams: {
            get: jest.fn().mockImplementation((param) => {
              if (param === 'section') return 'main';
              return null;
            })
          }
        }
      } as unknown as NextRequest;

      const response = await GET(mockRequestWithSection, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData).toHaveProperty('error');
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

  describe('GET /api/sermons/:id/plan?outlinePointId=<id>', () => {
    it('should generate content for outline point', async () => {
      (getThoughtsForOutlinePoint as jest.Mock).mockReturnValue([
        { id: 't1', text: 'First thought', tags: [], date: '2023-01-01', outlinePointId: 'p1', keyFragments: ['k1'] },
        { id: 't2', text: 'Second thought', tags: [], date: '2023-01-01', outlinePointId: 'p1', keyFragments: ['k2'] },
      ]);

      const mockRequestWithOutline = {
        nextUrl: {
          searchParams: {
            get: jest.fn().mockImplementation((param) => {
              if (param === 'outlinePointId') return 'p1';
              if (param === 'style') return 'memory';
              return null;
            })
          }
        }
      } as unknown as NextRequest;

      const response = await GET(mockRequestWithOutline, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      expect(generatePlanPointContent).toHaveBeenCalledWith(
        mockSermon.title,
        mockSermon.verse,
        'Intro point',
        ['First thought', 'Second thought'],
        'introduction',
        ['k1', 'k2'],
        {
          previousPoint: { text: 'Prev' },
          nextPoint: { text: 'Next' },
          section: 'introduction',
        },
        'memory'
      );
      expect(responseData).toEqual({ content: 'Outline content' });
    });

    it('should generate content for main outline point with mixed key fragments', async () => {
      (getThoughtsForOutlinePoint as jest.Mock).mockReturnValue([
        { id: 't3', text: 'Main thought', tags: [], date: '2023-01-01', outlinePointId: 'p2' },
        { id: 't4', text: 'Main thought 2', tags: [], date: '2023-01-01', outlinePointId: 'p2', keyFragments: ['k3'] },
      ]);

      const mockRequestWithOutline = {
        nextUrl: {
          searchParams: {
            get: jest.fn().mockImplementation((param) => {
              if (param === 'outlinePointId') return 'p2';
              return null;
            })
          }
        }
      } as unknown as NextRequest;

      const response = await GET(mockRequestWithOutline, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      expect(generatePlanPointContent).toHaveBeenCalledWith(
        mockSermon.title,
        mockSermon.verse,
        'Main point',
        ['Main thought', 'Main thought 2'],
        'main',
        ['k3'],
        {
          previousPoint: { text: 'Prev' },
          nextPoint: { text: 'Next' },
          section: 'introduction',
        },
        'memory'
      );
      expect(responseData).toEqual({ content: 'Outline content' });
    });

    it('should return 404 when outline point is not found', async () => {
      const mockRequestWithOutline = {
        nextUrl: {
          searchParams: {
            get: jest.fn().mockImplementation((param) => {
              if (param === 'outlinePointId') return 'missing';
              return null;
            })
          }
        }
      } as unknown as NextRequest;

      const response = await GET(mockRequestWithOutline, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      expect(response.status).toBe(404);
      expect(responseData).toHaveProperty('error');
    });

    it('should return 400 when no thoughts exist for outline point', async () => {
      (getThoughtsForOutlinePoint as jest.Mock).mockReturnValue([]);

      const mockRequestWithOutline = {
        nextUrl: {
          searchParams: {
            get: jest.fn().mockImplementation((param) => {
              if (param === 'outlinePointId') return 'p1';
              return null;
            })
          }
        }
      } as unknown as NextRequest;

      const response = await GET(mockRequestWithOutline, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      expect(response.status).toBe(400);
      expect(responseData).toHaveProperty('error');
    });

    it('should return 500 when outline point generation fails', async () => {
      (getThoughtsForOutlinePoint as jest.Mock).mockReturnValue([
        { id: 't5', text: 'Thought', tags: [], date: '2023-01-01', outlinePointId: 'p1' },
      ]);
      (generatePlanPointContent as jest.Mock).mockResolvedValue({ content: '', success: false });

      const mockRequestWithOutline = {
        nextUrl: {
          searchParams: {
            get: jest.fn().mockImplementation((param) => {
              if (param === 'outlinePointId') return 'p1';
              return null;
            })
          }
        }
      } as unknown as NextRequest;

      const response = await GET(mockRequestWithOutline, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData).toHaveProperty('error');
    });
  });

  describe('PUT /api/sermons/:id/plan', () => {
    it('should return 404 when sermon is not found', async () => {
      (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValue(null);

      const mockRequest = {
        json: jest.fn().mockResolvedValue({}),
      } as unknown as NextRequest;

      const response = await PUT(mockRequest, { params: Promise.resolve({ id: 'missing-sermon' }) });
      const responseData = await response.json();

      expect(response.status).toBe(404);
      expect(responseData).toHaveProperty('error');
    });

    it('should return 400 for invalid plan data', async () => {
      const mockRequest = {
        json: jest.fn().mockResolvedValue(null),
      } as unknown as NextRequest;

      const response = await PUT(mockRequest, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      expect(response.status).toBe(400);
      expect(responseData).toHaveProperty('error');
    });

    it('should save plan content and return success', async () => {
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          introduction: { outline: 'Intro', outlinePoints: { p1: 'Intro point' } },
          main: { outline: 'Main', outlinePoints: { p2: 'Main point' } },
          conclusion: { outline: 'Conclusion' },
        }),
      } as unknown as NextRequest;

      const response = await PUT(mockRequest, { params: Promise.resolve({ id: 'test-sermon-123' }) });
      const responseData = await response.json();

      expect(sermonsRepository.updateSermonContent).toHaveBeenCalledWith('test-sermon-123', expect.any(Object));
      expect(responseData).toHaveProperty('success', true);
      expect(responseData.plan).toHaveProperty('introduction');
      expect(responseData.plan).toHaveProperty('main');
      expect(responseData.plan).toHaveProperty('conclusion');
    });
  });
});
