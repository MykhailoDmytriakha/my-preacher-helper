import { NextRequest } from 'next/server';

import { generatePlanForSection, generatePlanPointContent } from '@/api/clients/openAI.client';
import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { GET, PUT } from '@/api/sermons/[id]/plan/route';
import { sermonsRepository } from '@/api/repositories/sermons.repository';
import { getVisualOrderedThoughtsForOutlinePoint } from '@/utils/sermonVisualOrder';

// Mock dependencies
jest.mock('@/api/repositories/sermons.repository');
jest.mock('@/api/clients/openAI.client');
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({
  getRequiredAuthenticatedUid: jest.fn(),
}));
jest.mock('@/utils/sermonVisualOrder');
jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, options = {}) => ({
      status: options.status || 200,
      headers: new Headers(options.headers),
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
    (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValue('user-123');
    
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

  describe('GET /api/sermons/:id/plan without outlinePointId (legacy whole-section save, closed)', () => {
    const withSection = (section: string | null) => ({
      nextUrl: { searchParams: { get: jest.fn((key: string) => (key === 'section' ? section : null)) } },
    }) as unknown as NextRequest;

    it('returns 401 before loading the sermon when the token is missing', async () => {
      (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValueOnce(null);

      const response = await GET(mockRequest, { params: Promise.resolve({ id: 'test-sermon-123' }) });

      expect(response.status).toBe(401);
      expect(sermonsRepository.fetchSermonById).not.toHaveBeenCalled();
    });

    it.each([null, 'introduction', 'main', 'conclusion'])('refuses section=%s with 426, generating and saving nothing', async section => {
      const response = await GET(withSection(section), { params: Promise.resolve({ id: 'test-sermon-123' }) });

      expect(response.status).toBe(426);
      expect(await response.json()).toMatchObject({ code: 'data-engine-required' });
      expect(sermonsRepository.fetchSermonById).not.toHaveBeenCalled();
      expect(generatePlanForSection).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/sermons/:id/plan?outlinePointId=<id>', () => {
    it('should generate content for outline point', async () => {
      (getVisualOrderedThoughtsForOutlinePoint as jest.Mock).mockReturnValue([
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

      expect(response.headers.get('Cache-Control')).toContain('no-store');
      expect(generatePlanPointContent).toHaveBeenCalledWith(
        mockSermon.title,
        mockSermon.verse,
        'Intro point',
        [
          { id: 't1', content: 'First thought', position: undefined, subPointId: null },
          { id: 't2', content: 'Second thought', position: undefined, subPointId: null },
        ],
        'introduction',
        ['k1', 'k2'],
        {
          previousPoint: { text: 'Prev' },
          nextPoint: { text: 'Next' },
          section: 'introduction',
        },
        'memory',
        undefined,
        mockSermon.userId
      );
      expect(responseData).toEqual({ content: 'Outline content' });
    });

    it('should generate content for main outline point with mixed key fragments', async () => {
      (getVisualOrderedThoughtsForOutlinePoint as jest.Mock).mockReturnValue([
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
        [
          { id: 't3', content: 'Main thought', position: undefined, subPointId: null },
          { id: 't4', content: 'Main thought 2', position: undefined, subPointId: null },
        ],
        'main',
        ['k3'],
        {
          previousPoint: { text: 'Prev' },
          nextPoint: { text: 'Next' },
          section: 'introduction',
        },
        'memory',
        undefined,
        mockSermon.userId
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
      (getVisualOrderedThoughtsForOutlinePoint as jest.Mock).mockReturnValue([]);

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

    it('passes sub-point aware structured thoughts in render order and normalizes orphaned sub-point ids', async () => {
      const sermonWithSubPoints = {
        ...mockSermon,
        outline: {
          introduction: [
            {
              id: 'p1',
              text: 'Intro point',
              subPoints: [{ id: 'sp-1', text: 'Inner point', position: 2500 }],
            },
          ],
          main: mockSermon.outline.main,
          conclusion: mockSermon.outline.conclusion,
        },
      };
      (sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValue(sermonWithSubPoints);
      (getVisualOrderedThoughtsForOutlinePoint as jest.Mock).mockReturnValue([
        { id: 't2', text: 'Sub-point thought', tags: [], date: '2023-01-01', outlinePointId: 'p1', subPointId: 'sp-1', position: 3000 },
        { id: 't3', text: 'Orphan thought', tags: [], date: '2023-01-01', outlinePointId: 'p1', subPointId: 'missing-sub-point', position: 2000 },
        { id: 't1', text: 'Direct thought', tags: [], date: '2023-01-01', outlinePointId: 'p1', position: 1000 },
      ]);

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

      await GET(mockRequestWithOutline, { params: Promise.resolve({ id: 'test-sermon-123' }) });

      expect(generatePlanPointContent).toHaveBeenCalledWith(
        sermonWithSubPoints.title,
        sermonWithSubPoints.verse,
        'Intro point',
        [
          { id: 't1', content: 'Direct thought', position: 1000, subPointId: null },
          { id: 't3', content: 'Orphan thought', position: 2000, subPointId: null },
          { id: 't2', content: 'Sub-point thought', position: 3000, subPointId: 'sp-1' },
        ],
        'introduction',
        [],
        {
          previousPoint: { text: 'Prev' },
          nextPoint: { text: 'Next' },
          section: 'introduction',
        },
        'memory',
        [{ id: 'sp-1', text: 'Inner point', position: 2500 }],
        sermonWithSubPoints.userId
      );
    });

    it('should return 500 when outline point generation fails', async () => {
      (getVisualOrderedThoughtsForOutlinePoint as jest.Mock).mockReturnValue([
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

  describe('PUT /api/sermons/:id/plan (legacy write route, closed)', () => {
    const put = () => PUT(
      { json: jest.fn().mockResolvedValue({ main: { outline: 'Main, edited here' } }) } as unknown as NextRequest,
    );

    it('answers 401 without a verified token and reads nothing', async () => {
      (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValueOnce(null);

      expect((await put()).status).toBe(401);
      expect(sermonsRepository.fetchSermonById).not.toHaveBeenCalled();
    });

    it('answers 426 data-engine-required with a token and writes nothing', async () => {
      const response = await put();

      expect(response.status).toBe(426);
      expect(await response.json()).toMatchObject({ code: 'data-engine-required' });
      expect(sermonsRepository.fetchSermonById).not.toHaveBeenCalled();
    });
  });
});
