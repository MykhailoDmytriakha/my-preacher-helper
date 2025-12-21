// We'll use a simpler approach without importing from Next.js
// This avoids the 'Request is not defined' error

import { adminDb } from '@/config/firebaseAdminConfig';

// Mock type for Request
interface MockRequest {
  url?: string;
  json: () => Promise<any>;
}

// Mock the adminDb to avoid actual Firestore calls
jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
  },
}));

// Mock the NextResponse
jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, options = {}) => {
      return {
        status: options.status || 200,
        json: async () => data,
      };
    }),
  },
}));

// Import the handlers module directly to mock
import * as sermonsRouteModule from 'app/api/sermons/route';

describe('Sermons API Route', () => {
  let mockRequest: MockRequest;
  let mockCollection: jest.Mock;
  let mockWhere: jest.Mock;
  let mockGet: jest.Mock;
  let mockAdd: jest.Mock;
  let mockDocs: any[];
  let mockDocRef: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Set up mock docs for GET tests
    mockDocs = [
      {
        id: 'sermon1',
        data: () => ({
          userId: 'user123',
          title: 'Test Sermon 1',
          verse: 'John 3:16',
          date: '2023-01-01',
          thoughts: []
        })
      },
      {
        id: 'sermon2',
        data: () => ({
          userId: 'user123',
          title: 'Test Sermon 2',
          verse: 'Romans 8:28',
          date: '2023-01-02',
          thoughts: [{ id: 'thought1', text: 'Test thought', tags: [], date: '2023-01-02' }]
        })
      }
    ];

    // Set up mock docRef for POST tests
    mockDocRef = {
      id: 'newSermonId123'
    };

    // Create mock Firestore chain
    mockGet = jest.fn().mockResolvedValue({ docs: mockDocs });
    mockWhere = jest.fn().mockReturnValue({ get: mockGet });
    mockAdd = jest.fn().mockResolvedValue(mockDocRef);
    mockCollection = jest.fn().mockReturnValue({
      where: mockWhere,
      add: mockAdd
    });

    // Apply the mocks
    const mockedAdminDb = adminDb as { collection: jest.Mock };
    mockedAdminDb.collection.mockImplementation(mockCollection);

    // Set up basic request object
    mockRequest = {
      json: jest.fn(),
    };
  });

  describe('GET handler', () => {
    test('should return sermons for a valid userId', async () => {
      // Arrange
      mockRequest.url = 'https://example.com/api/sermons?userId=user123';

      // Act
      const response = await sermonsRouteModule.GET(mockRequest as unknown as Request);
      const responseData = await response.json();

      // Assert
      expect(mockCollection).toHaveBeenCalledWith('sermons');
      expect(mockWhere).toHaveBeenCalledWith('userId', '==', 'user123');
      expect(mockGet).toHaveBeenCalled();
      expect(responseData).toHaveLength(2);
      expect(responseData[0].id).toBe('sermon1');
      expect(responseData[0].title).toBe('Test Sermon 1');
      expect(responseData[1].id).toBe('sermon2');
      expect(responseData[1].thoughts).toHaveLength(1);
    });

    test('should return 401 when userId is missing', async () => {
      // Arrange
      mockRequest.url = 'https://example.com/api/sermons';

      // Act
      const response = await sermonsRouteModule.GET(mockRequest as unknown as Request);
      const responseData = await response.json();
      
      // Assert
      expect(response.status).toBe(401);
      expect(responseData).toHaveProperty('error');
      expect(responseData.error).toBe('User not authenticated');
      expect(mockCollection).not.toHaveBeenCalled();
    });

    test('should handle Firestore errors', async () => {
      // Arrange
      mockRequest.url = 'https://example.com/api/sermons?userId=user123';
      mockGet.mockRejectedValueOnce(new Error('Firestore error'));

      // Act
      const response = await sermonsRouteModule.GET(mockRequest as unknown as Request);
      const responseData = await response.json();
      
      // Assert
      expect(response.status).toBe(500);
      expect(responseData).toHaveProperty('error');
      expect(responseData.error).toBe('Failed to fetch sermons');
    });
  });

  describe('POST handler', () => {
    test('should create a sermon successfully', async () => {
      // Arrange
      const sermonData = {
        userId: 'user123',
        title: 'New Sermon',
        verse: 'Matthew 5:1-12',
        date: '2023-02-01',
        thoughts: []
      };
      mockRequest.json = jest.fn().mockResolvedValueOnce(sermonData);

      // Act
      const response = await sermonsRouteModule.POST(mockRequest as unknown as Request);
      const responseData = await response.json();

      // Assert
      expect(mockCollection).toHaveBeenCalledWith('sermons');
      expect(mockAdd).toHaveBeenCalledWith({
        userId: 'user123',
        title: 'New Sermon',
        verse: 'Matthew 5:1-12',
        date: '2023-02-01',
        thoughts: []
      });
      expect(response.status).toBe(200);
      expect(responseData).toHaveProperty('message', 'Sermon created successfully');
      expect(responseData).toHaveProperty('sermon');
      expect(responseData.sermon.id).toBe('newSermonId123');
      expect(responseData.sermon.title).toBe('New Sermon');
    });

    test('should return 400 when required fields are missing', async () => {
      // Test scenarios for each required field
      const testCases = [
        { ...{ title: 'Test', verse: 'John 3:16', date: '2023-01-01' }, missing: 'userId' },
        { ...{ userId: 'user123', verse: 'John 3:16', date: '2023-01-01' }, missing: 'title' },
        { ...{ userId: 'user123', title: 'Test', date: '2023-01-01' }, missing: 'verse' },
        { ...{ userId: 'user123', title: 'Test', verse: 'John 3:16' }, missing: 'date' }
      ];

      for (const testCase of testCases) {
        // Arrange
        mockRequest.json = jest.fn().mockResolvedValueOnce(testCase);

        // Act
        const response = await sermonsRouteModule.POST(mockRequest as unknown as Request);
        const responseData = await response.json();
        
        // Assert
        expect(response.status).toBe(400);
        expect(responseData).toHaveProperty('error');
        expect(responseData.error).toBe('User not authenticated or sermon data is missing');
        expect(mockAdd).not.toHaveBeenCalled();
      }
    });

    test('should handle Firestore errors when creating sermon', async () => {
      // Arrange
      const sermonData = {
        userId: 'user123',
        title: 'New Sermon',
        verse: 'Matthew 5:1-12',
        date: '2023-02-01',
        thoughts: []
      };
      mockRequest.json = jest.fn().mockResolvedValueOnce(sermonData);
      mockAdd.mockRejectedValueOnce(new Error('Firestore error'));

      // Act
      const response = await sermonsRouteModule.POST(mockRequest as unknown as Request);
      const responseData = await response.json();
      
      // Assert
      expect(response.status).toBe(500);
      expect(responseData).toHaveProperty('error');
      expect(responseData.error).toBe('Failed to create sermon');
    });

    test('should handle request parsing errors', async () => {
      // Arrange
      mockRequest.json = jest.fn().mockRejectedValueOnce(new Error('Invalid JSON'));

      // Act
      const response = await sermonsRouteModule.POST(mockRequest as unknown as Request);
      const responseData = await response.json();
      
      // Assert
      expect(response.status).toBe(500);
      expect(responseData).toHaveProperty('error');
      expect(responseData.error).toBe('Failed to create sermon');
    });

    test('should correctly create sermon with optional thoughts field', async () => {
      // Arrange
      const sermonData = {
        userId: 'user123',
        title: 'New Sermon',
        verse: 'Matthew 5:1-12',
        date: '2023-02-01'
        // thoughts field is intentionally omitted
      };
      mockRequest.json = jest.fn().mockResolvedValueOnce(sermonData);

      // Act
      const response = await sermonsRouteModule.POST(mockRequest as unknown as Request);
      const responseData = await response.json();

      // Assert
      expect(mockAdd).toHaveBeenCalledWith({
        userId: 'user123',
        title: 'New Sermon',
        verse: 'Matthew 5:1-12', 
        date: '2023-02-01',
        thoughts: [] // Should default to empty array
      });
      expect(responseData.sermon.id).toBe('newSermonId123');
    });

    test('should preserve existing fields from sermon input', async () => {
      // Arrange
      const sermonData = {
        userId: 'user123',
        title: 'New Sermon',
        verse: 'Matthew 5:1-12',
        date: '2023-02-01',
        thoughts: [],
        outline: { introduction: [], main: [], conclusion: [] },
        customField: 'test value'
      };
      mockRequest.json = jest.fn().mockResolvedValueOnce(sermonData);

      // Act
      const response = await sermonsRouteModule.POST(mockRequest as unknown as Request);
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(responseData.sermon).toHaveProperty('customField', 'test value');
      expect(responseData.sermon).toHaveProperty('outline');
      expect(responseData.sermon.id).toBe('newSermonId123');
    });

    test('should override id properly in returned sermon object', async () => {
      // Arrange - test the case where input already has an id
      const sermonData = {
        id: 'existingId', // This should be overridden
        userId: 'user123',
        title: 'New Sermon',
        verse: 'Matthew 5:1-12',
        date: '2023-02-01',
        thoughts: []
      };
      mockRequest.json = jest.fn().mockResolvedValueOnce(sermonData);

      // Act
      const response = await sermonsRouteModule.POST(mockRequest as unknown as Request);
      const responseData = await response.json();

      // Assert
      expect(responseData.sermon.id).toBe('newSermonId123'); // Should use the new ID
      expect(responseData.sermon.id).not.toBe('existingId'); // Should not keep the old ID
    });
  });
}); 
